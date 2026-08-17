// History rendering — extracted from index.html (modular migration, step 9).
// Classic script, loaded before the main inline script (shared global scope).
// Covers: sort state, species carousel (spBuildPanel/spSlideHtml/spRowHtml/
//   initSpeciesPanel/spJump/spStep), rarestSighting, Direction-D timeline card
//   (renderTlRow), trip/flat/country timeline renderers, renderHistory, the
//   full-view dive file (openDiveFile/closeDiveFile/renderDiveFile/dfTab/
//   dfToggleMore), and lazy-init trip maps (_initTripMaps/_buildTripMap).
// Depends on globals: dives[], SPECIES_DB, BROWSE_GROUPS, GROUP_EMOJI,
//   SP_PHOTO_MAP, SP_IUCN_MAP, iucnBadge(), _iucnRank() (album.js),
//   loadLeaflet() (map.js), calcSAC()/sacClass() (stats.js), openFootage()
//   (footage.js), openEdit()/deleteDive()/downloadDiveCard() (app.js).

// History
// ── History sort state ──────────────────────────────────────────────────────
let sortKey = 'num';
let sortDir = -1; // 1 = asc, -1 = desc — default: newest dive first
let historyPage = 0;  // current page index (0-based)
const HISTORY_PER_PAGE = 10;

// ── Bulk selection (multi-select + trip-assign, v2.89) ──────────────────────
// Born from the BLE/UDDF bulk-add flow: a fresh sync can drop 90+ skeleton
// dives into History in one go, all sharing an empty trip/region/location —
// they land in a single "Ungrouped" bucket, and the existing trip-rename
// action (renames a whole EXISTING group) has nothing to operate on until
// the diver has already split that pile into trips by hand, one dive at a
// time. Selection mode lets a checkbox+range pick of ARBITRARY dives feed
// the same underlying apply-trip logic (_applyTripToDiveList, above).
let _selectMode = false;
let _selectedDiveIds = new Set();
// Which action bar the shared selection mode is currently driving —
// 'trip' (bulk trip-assign, original) or 'divenum' (bulk renumber-shift,
// added alongside it under the "Bulk edit" grouping). The tap-to-select
// mechanics below (_toggleDiveSelect, _historyDomOrder, _syncSelectionDom,
// the checkbox overlay gated on the plain _selectMode boolean) are entirely
// shared and unaware of this — only _updateSelectBar and toggleSelectMode
// itself branch on it.
let _selectAction = 'trip';
let _selectAnchorId = null; // fixed anchor for range-select, mirrors shift-click

const sortFns = {
  num:     (a, b) => (parseInt(a.divenum) || 0) - (parseInt(b.divenum) || 0),
  depth:   (a, b) => (parseFloat(a.depth) || 0) - (parseFloat(b.depth) || 0),
  country: (a, b) => (a.location || '').localeCompare(b.location || ''),

};

function setSort(key) {
  if (sortKey === key) {
    sortDir *= -1; // toggle direction
  } else {
    sortKey = key;
    // Sensible default directions
    sortDir = key === 'depth' ? -1 : 1;
  }
  // Update button states. aria-pressed, matching the segmented-toggle
  // convention already established elsewhere (lfPaintSeg, js/logform.js;
  // setActivityView, js/stats.js) for "exactly one of N always active" —
  // direction (asc/desc) stays a visual-only detail carried by the arrow.
  document.querySelectorAll('.sort-btn').forEach(b => { b.classList.remove('active'); b.setAttribute('aria-pressed', 'false'); });
  const activeBtn = document.getElementById('sort-' + key);
  activeBtn.classList.add('active');
  activeBtn.setAttribute('aria-pressed', 'true');
  // Update arrows
  const arrowMap = { num: 'arr-num', depth: 'arr-depth', country: 'arr-country' };
  Object.values(arrowMap).forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = '↓';
  });
  const activeArrow = document.getElementById(arrowMap[key]);
  if (activeArrow) activeArrow.textContent = sortDir === 1 ? '↑' : '↓';
  historyPage = 0; // reset to first page on sort change
  renderHistory();
}

function getSortedDives() {
  return [...dives].sort((a, b) => sortFns[sortKey](a, b) * sortDir);
}

// ── Phase C: expanded card helpers ──────────────────────────────────────

// Per-dive pagination state: diveId → current page (0-based)
// iNaturalist variants: square(75) medium(500) large(1024). Mobile loads
// medium (bandwidth); desktop loads large (bigger carousel). Decided once.
const SP_HERO = matchMedia('(max-width: 759px)').matches ? 'medium' : 'large';
// Per-dive carousel runtime state, keyed by dive id (set on card open)
const spReg = {};

// Order a dive's sightings by taxon (BROWSE_GROUPS), then alphabetically
// by common name — identical to the species browse-mode ordering.
function spOrderMarine(marine) {
  const gi = g => { const i = BROWSE_GROUPS.indexOf(g); return i === -1 ? BROWSE_GROUPS.length : i; };
  return marine.slice().sort((a, b) => {
    const d = gi(a.group) - gi(b.group);
    if (d) return d;
    return (a.commonName || a.scientificName || '').toLowerCase()
      .localeCompare((b.commonName || b.scientificName || '').toLowerCase());
  });
}



// One carousel slide (large hero photo)
function spSlideHtml(m, i, diveId) {
  const rawUrl = SP_PHOTO_MAP[m.scientificName] || '';
  const hero   = rawUrl ? rawUrl.replace('square', SP_HERO) : '';
  const status = SP_IUCN_MAP[m.scientificName] || '';
  const emoji  = GROUP_EMOJI[m.group] || '🐟';
  const name   = esc(m.commonName || m.scientificName);   // free-text species are user input
  const sci    = (m.commonName && m.scientificName !== m.commonName) ? esc(m.scientificName) : '';
  const photo  = hero
    ? `<img src="${hero}" alt="${name}" loading="lazy">`
    : `<span class="sp-ph">${emoji}</span>`;
  const hasClips = typeof _sightingHasClips === 'function' && _sightingHasClips(m);
  const sciKey   = esc(m.scientificName || m.customId || '');
  const playBtn  = hasClips
    ? `<button class="sp-play" title="Watch footage" data-did="${diveId}" data-sci="${sciKey}" onclick="event.stopPropagation();openFootage(+this.dataset.did,{mode:'watch',expandKey:this.dataset.sci})">▶</button>`
    : '';
  return `<div class="sp-slide" data-i="${i}">
    <div class="sp-slide-inner">
      <div class="sp-photo">${photo}${playBtn}</div>
      <div class="sp-sbody">
        <div class="sp-shead">
          <div>
            <div class="sp-sname">${name}</div>
            ${sci ? `<div class="sp-ssci">${sci}</div>` : ''}
          </div>
          ${status ? iucnBadge(status) : ''}
        </div>
        <div class="sp-sfoot">
          <span>${esc(m.group || '')}</span>
          ${typeof _vidMarkHtml === 'function' ? _vidMarkHtml(m, diveId) : ''}
          ${m.abundance ? `<span><span class="sp-ab">${esc(m.abundance)}</span></span>` : ''}
          ${m.validated === false ? '<span class="sp-pending" title="Unvalidated — needs attention">● unvalidated</span>' : ''}
        </div>
      </div>
    </div>
  </div>`;
}

// One scannable list row (small thumbnail)
function spRowHtml(m, i, diveId) {
  const rawUrl = SP_PHOTO_MAP[m.scientificName] || '';
  const status = SP_IUCN_MAP[m.scientificName] || '';
  const emoji  = GROUP_EMOJI[m.group] || '🐟';
  const name   = esc(m.commonName || m.scientificName);   // free-text species are user input
  const sci    = (m.commonName && m.scientificName !== m.commonName) ? esc(m.scientificName) : '';
  const thumb  = rawUrl
    ? `<img src="${rawUrl}" alt="" loading="lazy">`
    : `<span class="sp-ph">${emoji}</span>`;
  return `<div class="sp-row${i === 0 ? ' active' : ''}" data-i="${i}" onclick="spJump(${diveId},${i})">
    <div class="sp-thumb">${thumb}</div>
    <div class="sp-txt">
      <div class="sp-name">${name}</div>
      ${sci ? `<div class="sp-sci">${sci}</div>` : ''}
    </div>
    <div class="sp-rmeta">
      ${typeof _vidMarkHtml === 'function' ? _vidMarkHtml(m, diveId) : ''}
      ${m.validated === false ? '<span class="sp-pending" title="Unvalidated — needs attention">●</span>' : ''}
      ${status ? iucnBadge(status) : ''}
      ${m.abundance ? `<span class="sp-ab">${esc(m.abundance)}</span>` : ''}
    </div>
  </div>`;
}

// Build the ordered slides + grouped list (headers on taxon change)
function spBuildPanel(marine, diveId) {
  const ordered = spOrderMarine(marine);
  const groupCount = {};
  ordered.forEach(m => { const g = m.group || 'Other'; groupCount[g] = (groupCount[g] || 0) + 1; });
  let slides = '', list = '', lastGroup = null;
  ordered.forEach((m, i) => {
    slides += spSlideHtml(m, i, diveId);
    const g = m.group || 'Other';
    if (g !== lastGroup) {
      list += `<div class="sp-ghead">${GROUP_EMOJI[g] || '🐟'} ${g} <span class="sp-gc">${groupCount[g]}</span></div>`;
      lastGroup = g;
    }
    list += spRowHtml(m, i, diveId);
  });
  return { slides, list, total: ordered.length };
}

// Wire the carousel ↔ list for one dive. Called when its card opens.
// Idempotent: guarded by a data flag on the (re-rendered) carousel node.
function initSpeciesPanel(diveId) {
  const car = document.getElementById(`sp-car-${diveId}`);
  if (!car || car.dataset.spReady) return;
  car.dataset.spReady = '1';

  const list   = document.getElementById(`sp-list-${diveId}`);
  const countEl= document.getElementById(`sp-count-${diveId}`);
  const prevEl = document.getElementById(`sp-prev-${diveId}`);
  const nextEl = document.getElementById(`sp-next-${diveId}`);
  const carWrap= car.closest('.sp-carwrap');
  const slides = [...car.children];
  const rows   = [...list.querySelectorAll('.sp-row')];
  const mqMobile = matchMedia('(max-width: 759px)');

  const st = { car, slides, rows, countEl, prevEl, nextEl, carWrap,
               mqMobile, lockTarget: null, active: 0 };
  spReg[diveId] = st;

  function update(i) {
    st.active = i;
    rows.forEach((r, j) => r.classList.toggle('active', j === i));
    countEl.textContent = (i + 1) + ' / ' + slides.length;
    prevEl.disabled = i === 0;
    nextEl.disabled = i === slides.length - 1;
  }
  st.update = update;

  const io = new IntersectionObserver((entries) => {
    entries.forEach(e => {
      if (!e.isIntersecting || e.intersectionRatio <= 0.6) return;
      const j = +e.target.dataset.i;
      update(j);
      if (st.lockTarget !== null) { if (j === st.lockTarget) st.lockTarget = null; return; }
      if (!mqMobile.matches) rows[j].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
  }, { root: car, threshold: [0.6] });
  slides.forEach(s => io.observe(s));

  update(0);
}

// List row tap → carousel slides to it. Mobile (stacked): jump the page
// up to the photo. Desktop (side-by-side): no jump, both already visible.
function spJump(diveId, i) {
  const st = spReg[diveId];
  if (!st) return;
  st.lockTarget = i;
  st.car.scrollTo({ left: i * st.car.clientWidth, behavior: 'smooth' });
  st.update(i);
  if (st.mqMobile.matches && st.carWrap)
    st.carWrap.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// Carousel arrow buttons
function spStep(diveId, dir) {
  const st = spReg[diveId];
  if (!st) return;
  const i = Math.max(0, Math.min(st.slides.length - 1, st.active + dir));
  st.car.scrollTo({ left: i * st.car.clientWidth, behavior: 'smooth' });
}

// Returns the single "standout" sighting for a dive's history card, or null.
// Rarest by IUCN (CR>EN>VU>NT>LC>DD>unknown), tie-break by commonName.
// Reuses _iucnRank() from album.js and SP_IUCN_MAP from species.js.
function rarestSighting(dive) {
  const marine = dive.marine || [];
  if (!marine.length) return null;
  return marine.slice().sort((a, b) => {
    const r = _iucnRank(SP_IUCN_MAP[b.scientificName]) - _iucnRank(SP_IUCN_MAP[a.scientificName]);
    if (r) return r;
    return (a.commonName || '').localeCompare(b.commonName || '');
  })[0];
}

// ── Journal helpers ───────────────────────────────────────────────────────

// Returns { kind, text } for the "glimpse" line shown in timeline cards.
// Priority: title → first-sentence snippet from notes → empty.
// The auto-snippet is often the dull opener — the title is the curated path.
// No species fallback: the rarest species name + thumb already appear on the
// right of the timeline card, so falling back to it here just duplicates it.
function _diveGlimpse(d) {
  const title = (d.title || '').trim();
  if (title) return { kind: 'title', text: title };

  const rawNotes = (d.notes || '').trim();
  if (rawNotes) {
    const stripped = rawNotes.replace(/^[#*>\-]+\s*/, '').trim();
    if (stripped) {
      const sentMatch = stripped.match(/^(.+?[.!?])(?:\s|$)/);
      const firstSent = sentMatch ? sentMatch[1] : null;
      let snippet;
      if (firstSent && firstSent.length <= 70) {
        snippet = firstSent;
      } else {
        const src = stripped;
        if (src.length <= 70) {
          snippet = src;
        } else {
          const cut = src.lastIndexOf(' ', 70);
          snippet = (cut > 10 ? src.slice(0, cut) : src.slice(0, 70)) + '…';
        }
      }
      return { kind: 'snippet', text: snippet };
    }
  }

  return { kind: '', text: '' };
}

// Returns a journal-styled df-card block for both mobile Notes tab and desktop
// right-column placement. Call sites add their breakpoint wrapper as needed.
// showEmpty (desktop's always-visible journal slot only — mobile's Journal
// tab still doesn't exist at all when there's nothing to show, unchanged)
// swaps a blank return for a clickable invitation straight into edit mode:
// an empty journal sitting in permanent, spacious real estate is a nudge to
// fill it in, not just an empty state to apologise for.
function _notesBlockHtml(d, showEmpty) {
  const title = (d.title || '').trim();
  const notes = (d.notes || '').trim();
  if (!title && !notes) {
    if (!showEmpty) return '';
    return `<div class="df-card df-notes-block df-notes-empty" onclick="openEdit(${d.id})">
      <div class="df-notes-empty-txt">Nothing written yet — tap to add a title or notes.</div>
    </div>`;
  }

  // Mockup structure: JOURNAL kicker → serif headline (title) → [meta] → serif body.
  //
  // ── FUTURE (augmented conditions) — the meta line under the headline ─────────
  // The design adds a machine-derived meta row beneath the headline, e.g.:
  //   TIDE Falling · 1.4m   WIND 8kt NW   SWELL 0.6m   MOON Waxing gibbous  ↻ Auto-filled
  // This is NOT diver-entered: it's fetched retrospectively from APIs keyed on
  // gps_lat/gps_lng + date + entrytime — Open-Meteo Marine (wind/swell/SST), moon
  // phase computed locally, tide from a tide source (Admiralty is UK-only AND
  // must NOT be cached — see CLAUDE.md "Known constraints"). It augments the log
  // and must read as auto-generated (the "Auto-filled" tag), visually distinct
  // from the diver's prose.
  //
  // STORAGE: persist under a namespaced frontmatter block so it's clearly separate
  // from diver-logged fields and still round-trips for Dataview, e.g.
  //   env:
  //     tide: "Falling · 1.4m"
  //     wind: "8kt NW"
  //     swell: "0.6m"
  //     moon: "Waxing gibbous"
  //     fetched: 2026-06-27
  // Fetch-once-then-store (Open-Meteo permits caching; Admiralty does NOT).
  // frontmatterToDive() would read it into d.env; generateFrontmatter() would emit
  // it. Render here via a future helper, inserted between headline and body:
  //   ${'' /* ${typeof _journalMetaHtml === 'function' ? _journalMetaHtml(d) : ''} */}
  // CSS for the row is already reserved as .df-notes-meta in styles.css.
  return `<div class="df-card df-notes-block">
    ${title ? `<h2 class="df-notes-title">${esc(title)}</h2>` : ''}
    ${notes ? `<div class="df-notes-body">${esc(notes)}</div>` : ''}
  </div>`;
}

// ── Trip timeline helpers ─────────────────────────────────────────────────

// Group dives by trip → region → location → 'Ungrouped'
function groupDivesByTrip(sorted) {
  const groups = [];
  const keyMap = new Map();
  sorted.forEach(d => {
    const key = (d.trip || d.region || d.location || 'Ungrouped').trim();
    if (!keyMap.has(key)) {
      keyMap.set(key, { key, dives: [] });
      groups.push(keyMap.get(key));
    }
    keyMap.get(key).dives.push(d);
  });
  return groups;
}

// "Wed 13" from "2026-05-13"
function tlDayStr(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00');
  if (isNaN(d)) return '';
  const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  return days[d.getDay()] + ' ' + d.getDate();
}

// "May 2026" or "Oct–Nov 2025" for a group of dives
function tlMonthRange(dives) {
  const dates = dives.map(d => d.date).filter(Boolean).sort();
  if (!dates.length) return '';
  const parse = ds => { const d = new Date(ds + 'T00:00:00'); return isNaN(d) ? null : d; };
  const first = parse(dates[0]);
  const last  = parse(dates[dates.length - 1]);
  if (!first) return '';
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  if (!last || (first.getMonth() === last.getMonth() && first.getFullYear() === last.getFullYear())) {
    return months[first.getMonth()] + ' ' + first.getFullYear();
  }
  if (first.getFullYear() === last.getFullYear()) {
    return months[first.getMonth()] + '–' + months[last.getMonth()] + ' ' + first.getFullYear();
  }
  return months[first.getMonth()] + ' ' + first.getFullYear() + '–' + months[last.getMonth()] + ' ' + last.getFullYear();
}

// Trip header "where" string: liveaboard (if set) or region, plus country
function tlWhereStr(group) {
  const d0 = group.dives[0];
  const place = d0.liveaboard || d0.region; // liveaboard takes priority over region
  const parts = [place, d0.location].filter(Boolean);
  return parts.slice(0, 2).join(', ');
}

// Day-span of a trip group (for stats)
function tlDaySpan(dives) {
  const dates = dives.map(d => d.date).filter(Boolean).sort();
  if (dates.length < 2) return 1;
  const a = new Date(dates[0] + 'T00:00:00');
  const b = new Date(dates[dates.length - 1] + 'T00:00:00');
  return Math.round((b - a) / 86400000) + 1;
}

// Unique species count across a group of dives
function tlSpeciesCount(dives) {
  const seen = new Set();
  dives.forEach(d => (d.marine || []).forEach(m => seen.add(m.scientificName || m.commonName)));
  return seen.size;
}

// ── Dive file — full-view navigation (Phase 2.18) ─────────────────────────

let _diveFileScrollY    = 0;    // restored on closeDiveFile
let _diveFileHeroLeaflet = null; // ambient hero map — torn down on closeDiveFile

function openDiveFile(id) {
  const d = dives.find(x => x.id === id);
  if (!d) return;
  _pushOverlayState({ type: 'diveFile', diveId: id });
  _diveFileScrollY = window.scrollY;
  document.getElementById('history-content').style.display = 'none';
  const cog = document.getElementById('mobile-cog');
  if (cog) cog.style.display = 'none';
  const view = document.getElementById('dive-file-view');
  view.innerHTML = renderDiveFile(d);
  view.style.display = '';
  window.scrollTo({ top: 0, behavior: 'instant' });
  if ((d.marine || []).length) setTimeout(() => initSpeciesPanel(d.id), 50);
  document.addEventListener('click', _dfMoreClose);
  // Ambient hero map — init after a tick so the container is in the DOM
  const lat = parseFloat(d.gps_lat), lng = parseFloat(d.gps_lng);
  if (!isNaN(lat) && !isNaN(lng)) {
    setTimeout(() => _initDiveHeroMap(d.id, lat, lng, d.entry), 80);
  }
}

function closeDiveFile() {
  closeTopOverlay();
}

function closeDiveFileDirect() {
  document.removeEventListener('click', _dfMoreClose);
  if (_diveFileHeroLeaflet) { _diveFileHeroLeaflet.remove(); _diveFileHeroLeaflet = null; }
  document.getElementById('dive-file-view').style.display = 'none';
  document.getElementById('history-content').style.display = '';
  const cog = document.getElementById('mobile-cog');
  if (cog) cog.style.display = '';
  window.scrollTo({ top: _diveFileScrollY, behavior: 'instant' });
}

// Repaints the open dive file in place on a theme change — renderProfileChart
// (js/profile.js) only reads --profile-* via getComputedStyle at render time,
// so a dive file left open across a toggle (or a System-mode OS flip while
// it's on-screen — no navigation needed to hit this) would otherwise show a
// stale-themed chart. Called from js/app.js's applyTheme(). Re-runs the same
// innerHTML/species-panel/hero-map setup openDiveFile() does, minus the
// overlay-stack push and scroll reset — a repaint in place, not a navigation.
function _dfRerenderProfileIfOpen() {
  const view = document.getElementById('dive-file-view');
  if (!view || view.style.display === 'none') return;
  const top = _openOverlays[_openOverlays.length - 1];
  if (!top || top.type !== 'diveFile') return;
  const d = dives.find(x => x.id === top.diveId);
  if (!d) return;
  if (_diveFileHeroLeaflet) { _diveFileHeroLeaflet.remove(); _diveFileHeroLeaflet = null; }
  view.innerHTML = renderDiveFile(d);
  if ((d.marine || []).length) setTimeout(() => initSpeciesPanel(d.id), 50);
  const lat = parseFloat(d.gps_lat), lng = parseFloat(d.gps_lng);
  if (!isNaN(lat) && !isNaN(lng)) setTimeout(() => _initDiveHeroMap(d.id, lat, lng, d.entry), 80);
}

// Back button on the dive file — always lands on History and scrolls to the dive's trip group.
// Lateral navigation: pops the overlay stack directly instead of history.back(), so the
// previous page (e.g. species profile) is not re-entered.
function goBackToHistory(diveId) {
  if (_openOverlays.length) _openOverlays.pop();
  document.removeEventListener('click', _dfMoreClose);
  if (_diveFileHeroLeaflet) { _diveFileHeroLeaflet.remove(); _diveFileHeroLeaflet = null; }
  document.getElementById('dive-file-view').style.display = 'none';
  document.getElementById('history-content').style.display = '';
  const cog = document.getElementById('mobile-cog');
  if (cog) cog.style.display = '';
  const card = document.getElementById('wrap-' + diveId);
  if (card) {
    const group  = card.closest('.tl-group');
    const target = group ? group.querySelector('.tl-header') : card;
    (target || card).scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

// Ambient hero map — GPS dives only; fills df-hero-map on both mobile and desktop
function _initDiveHeroMap(diveId, lat, lng, entry) {
  const el = document.getElementById('df-hero-map-' + diveId);
  if (!el || _diveFileHeroLeaflet) return;
  loadLeaflet().then(() => {
    if (_diveFileHeroLeaflet) return;
    try {
      _diveFileHeroLeaflet = L.map(el, { zoomControl: false, attributionControl: false, dragging: false, scrollWheelZoom: false, touchZoom: false, doubleClickZoom: false })
        .setView([lat, lng], 11);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors', maxZoom: 18
      }).addTo(_diveFileHeroLeaflet);
      // Was an L.circleMarker with a hardcoded #4A90B8 — light-mode --accent
      // inlined, so it stayed pale blue in Harbour Night and was invisible to
      // the token system. Now the same dive-type pin the History map uses
      // (_typePinIcon, js/map.js), which also means it re-colours on a theme
      // flip without this file knowing anything about colour.
      L.marker([lat, lng], {
        icon: _typePinIcon(entry, (typeof _texTypesOn === 'function') && _texTypesOn())
      }).addTo(_diveFileHeroLeaflet);
    } catch(e) { /* hero map init failed — silent, fallback is plain bg */ }
  }).catch(() => { /* leaflet load failed */ });
}

function dfHeroExpand(id) {
  const el = document.getElementById('df-hero-map-' + id);
  if (!el) return;
  el.classList.add('df-hero-fullscreen');
  const closeBtn = document.getElementById('df-hero-close-' + id);
  if (closeBtn) closeBtn.style.display = 'flex';
  if (_diveFileHeroLeaflet) {
    // Re-enable interaction when fullscreen
    _diveFileHeroLeaflet.dragging.enable();
    _diveFileHeroLeaflet.touchZoom.enable();
    _diveFileHeroLeaflet.doubleClickZoom.enable();
    setTimeout(() => _diveFileHeroLeaflet.invalidateSize(), 50);
  }
}

function dfHeroCollapse(id) {
  const el = document.getElementById('df-hero-map-' + id);
  if (!el) return;
  el.classList.remove('df-hero-fullscreen');
  const closeBtn = document.getElementById('df-hero-close-' + id);
  if (closeBtn) closeBtn.style.display = 'none';
  if (_diveFileHeroLeaflet) {
    _diveFileHeroLeaflet.dragging.disable();
    _diveFileHeroLeaflet.touchZoom.disable();
    _diveFileHeroLeaflet.doubleClickZoom.disable();
    setTimeout(() => _diveFileHeroLeaflet.invalidateSize(), 50);
  }
}

// Tab switching — show the selected panel, hide others
function dfTab(tabName, btn) {
  const view = document.getElementById('dive-file-view');
  view.querySelectorAll('.df-seg-btn').forEach(b => { b.classList.remove('active'); b.setAttribute('aria-selected', 'false'); });
  btn.classList.add('active');
  btn.setAttribute('aria-selected', 'true');
  view.querySelectorAll('.df-panel').forEach(p => {
    p.classList.toggle('active', p.dataset.tab === tabName);
  });
}

// ⋯ more menu toggle
function dfToggleMore(e, menuId) {
  e.stopPropagation();
  const menu = document.getElementById(menuId);
  if (!menu) return;
  const shown = menu.style.display !== 'none';
  document.querySelectorAll('.df-more-menu').forEach(m => m.style.display = 'none');
  menu.style.display = shown ? 'none' : 'block';
}

// Close more menu when clicking outside it
function _dfMoreClose(e) {
  if (!e.target.closest('.df-more-wrap')) {
    document.querySelectorAll('.df-more-menu').forEach(m => m.style.display = 'none');
  }
}

// ── Overview tab visual helpers (v2.96) — condition tiles, cylinder gauge,
// icon spec rows, mirroring the log form's own dials/icons so reading a
// dive uses the same visual language as logging one. _dfVisBarHtml is also
// called from profile.js's stat strip (history.js loads first in
// index.html, so the global exists by the time profile.js calls it).
function _dfVisBarHtml(vis) {
  const v = parseFloat(vis);
  if (!v || isNaN(v) || v <= 0) return '';
  const pct = Math.max(0, Math.min(100, v / 30 * 100));
  return `<div class="df-vbar-track"><div class="df-vbar-tick" style="left:${pct}%"></div></div>`;
}

// Inline SVG icons, not emoji — emoji glyphs are supplied by the platform,
// so they arrive at wildly different weights/palettes per device (and can't
// inherit --text-muted at all, which left them shouting next to the calm
// type they label). Outline style matches the app's existing inline SVGs
// (24×24 viewBox, fill:none, currentColor at 1.5).
const DF_ICONS = {
  sun:   '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  cloud: '<path d="M6.8 19a4.2 4.2 0 0 1 .5-8.4 5.7 5.7 0 0 1 10.8 1.5A3.6 3.6 0 0 1 17.3 19z"/>',
  rain:  '<path d="M6.9 15.6a4 4 0 0 1 .4-8 5.5 5.5 0 0 1 10.4 1.4 3.4 3.4 0 0 1 .2 6.6z"/><path d="M8.4 18.4l-1 2.6M12.4 18.4l-1 2.6M16.4 18.4l-1 2.6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  stop:  '<path d="M12 20V8M7 13l5-5 5 5M5 4h14"/>',
  suit:  '<path d="M8.5 3 12 5l3.5-2L20 6l-2.2 3L16 8v12H8V8L6.2 9 4 6z"/>',
  buddy: '<circle cx="12" cy="8" r="3.5"/><path d="M5.5 20a6.5 6.5 0 0 1 13 0"/>',
  boat:  '<circle cx="12" cy="4.4" r="1.8"/><path d="M12 6.2V20M8.5 10.5h7M5 14.5a7 7 0 0 0 14 0"/>',
  pen:   '<path d="m14.5 4.5 5 5M16 3l5 5L9 20H4v-5z"/>',
};
function _dfIcon(name, cls) {
  const dPath = DF_ICONS[name];
  if (!dPath) return '';
  return `<svg class="${cls || 'df-ov-ic'}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${dPath}</svg>`;
}

// No icon on temperature — a labelled gradient reading "29 °C" is already
// unambiguous, and a thermometer glyph beside it is pure decoration.
function _dfTempTileHtml(temp) {
  if (!temp && temp !== 0) return '';
  const t = parseFloat(temp);
  if (isNaN(t)) return '';
  const pct = Math.max(0, Math.min(100, t / 35 * 100));
  return `
    <div class="df-ov-tile-bar">
      <div class="df-ov-tile-head">
        <span class="df-ov-tile-label">Water temp</span>
        <span class="df-ov-tile-val">${t} °C</span>
      </div>
      <div class="df-ov-gaugebar df-ov-gaugebar-temp">
        <div class="df-ov-gauge-ticker" style="left:${pct}%"></div>
      </div>
    </div>`;
}

// Chevrons as SVG rather than a "›" text glyph — the glyph's weight and
// its optical size vary by font, which made the three read as inconsistent
// rather than as one deliberate ramp. Stroke-width is deliberately NOT
// non-scaling: the larger chevrons draw proportionally heavier, which
// reinforces the intensity ramp the sizes are already describing.
const DF_CURRENT_LEVELS = ['', 'Slight', 'Moderate', 'Strong'];
function _dfCurrentTileHtml(current) {
  const idx = DF_CURRENT_LEVELS.indexOf(current || '');
  const level = idx < 0 ? 0 : idx;
  const label = current || 'None';
  const arrows = [14, 19, 25].map((sz, i) =>
    `<svg class="df-ov-arrow${i < level ? ' filled' : ''}" width="${sz}" height="${sz}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 5 7 7-7 7"/></svg>`
  ).join('');
  return `
    <div class="df-ov-tile">
      <div class="df-ov-arrows">${arrows}</div>
      <div class="df-ov-tile-val">${esc(label)}</div>
      <div class="df-ov-tile-sub">Current</div>
    </div>`;
}

// Weather is stored as a free string (legacy values like "Sunny, calm" still
// exist), not a strict enum — fuzzy-match the icon picker's own three words
// and fall back to plain text with no icon rather than guessing.
function _dfWeatherTileHtml(weather, watertype) {
  const w = (weather || '').toString();
  const wl = w.toLowerCase();
  let icon = '';
  if (wl.includes('rain')) icon = 'rain';
  else if (wl.includes('cloud') || wl.includes('overcast')) icon = 'cloud';
  else if (wl.includes('sun')) icon = 'sun';
  const sub = 'Weather' + (watertype ? ' · ' + esc(watertype) : '');
  return `
    <div class="df-ov-tile">
      <div class="df-ov-tile-icon-lg">${icon ? _dfIcon(icon, 'df-ov-ic-lg') : ''}</div>
      <div class="df-ov-tile-val">${w ? esc(w) : '—'}</div>
      <div class="df-ov-tile-sub">${sub}</div>
    </div>`;
}

// Horizontal cylinder gauge — valve at the left (the "start" end, faint/
// unfilled), remaining gas fills from the right: the vertical mockup this
// was rotated from had start at top / remaining pooling at the bottom, so
// top→left, bottom→right under a 90° turn. Each number sits inside its own
// zone when there's room, else just outside the fill boundary — a near-empty
// tank can't fit "50" inside a 20px sliver of fill.
// Horizontal cylinder gauge. Drawn as a real tank silhouette — valve
// handwheel + stem, a neck, a shoulder tapering out to full diameter, and a
// domed base — rather than the rounded rect this started as, which read as
// a battery/lozenge with a detached dark square for a valve. Valve sits at
// the LEFT (the empty/start-pressure end) and remaining gas fills from the
// RIGHT: the original mockup was vertical with the valve on top and gas
// pooling at the bottom, so top→left and bottom→right under a 90° turn.
function _dfTankHtml(d, id, sac) {
  const pstart = parseFloat(d.pstart), pend = parseFloat(d.pend);
  if (!pstart || isNaN(pstart) || isNaN(pend) || pend < 0) return '';
  const GAUGE_L = 38, GAUGE_R = 292;
  const gaugeW = GAUGE_R - GAUGE_L;
  const pct    = Math.max(0, Math.min(1, pend / pstart));
  const fillW  = gaugeW * pct;
  const fillX  = GAUGE_R - fillW;
  // FIXED number positions, not zone-relative. Sizing each number to its own
  // zone meant they slid around as the fill moved and bunched up badly on a
  // light-usage dive (220→190) — which is the COMMON case, not the edge one.
  // Colour now runs on a real "is it on the fill" predicate applied to BOTH
  // numbers (2026-08-06 — previously only the end number got this check;
  // the start number's fill-agnostic "dark ink always reads" premise held
  // only because the fill itself was --accent, whose light-mode value is
  // dark enough for that to be true incidentally). The fill is now
  // --accent-fill (constant across themes, was --accent, which LIGHTENS on
  // dark and broke this exact assumption) and both on-fill cases use
  // --on-accent (guaranteed 4.51:1 on --accent-fill in every theme) rather
  // than a token whose light/dark value happened to work by accident.
  const START_X = 58, END_X = 272;
  const startTxt = String(Math.round(pstart)), endTxt = String(Math.round(pend));
  // Illegibility guard, not a style choice: below that ~18% the fill is too
  // narrow to sit behind the number at all. Tests the number's LEFT edge
  // (~14 units per digit at 20px bold) so a fill boundary landing mid-number
  // resolves off-fill rather than hiding its leading digits.
  const startOnFill = fillX <= START_X;
  const endOnFill = fillX <= END_X - endTxt.length * 14;
  // Rounded left end + a neck, NOT a tapered shoulder: the taper's curve read
  // as scooped/funnel-like at this size. Right end is a deeper dome.
  const tankPath = 'M 56 6 L 266 6 Q 292 6 292 30 Q 292 54 266 54 L 56 54 Q 38 54 38 36 L 38 24 Q 38 6 56 6 Z';
  const gasLine = [esc(d.gas), [esc(d.tanktype), d.tanksize ? d.tanksize + ' L' : ''].filter(Boolean).join(' ')]
    .filter(Boolean).join(' · ');
  const sacHtml = sac
    ? `<span class="df-ov-tank-sac"><span class="${sacClass(sac)}">${sac}</span> <span class="df-ov-tank-sac-lbl">SAC</span></span>` : '';
  return `
    <div class="df-ov-tank-block">
      <svg viewBox="0 0 300 60" class="df-ov-tank-svg" role="img" aria-label="Cylinder pressure ${startTxt} down to ${endTxt} bar">
        <clipPath id="dftk-${id}"><path d="${tankPath}"></path></clipPath>
        <rect x="5" y="17" width="12" height="26" rx="4" style="fill:var(--text-muted)"></rect>
        <rect x="16" y="26" width="13" height="8" rx="2" style="fill:var(--text-muted)"></rect>
        <rect x="27" y="24" width="16" height="12" rx="2" style="fill:var(--text-muted)"></rect>
        <path d="${tankPath}" style="fill:var(--surface2)"></path>
        <g clip-path="url(#dftk-${id})">
          <rect x="${fillX}" y="0" width="${fillW + 2}" height="60" style="fill:var(--accent-fill)"></rect>
        </g>
        <path d="${tankPath}" fill="none" style="stroke:var(--border-mid)" stroke-width="1.5"></path>
        <text x="${START_X}" y="37" text-anchor="start" class="df-ov-tank-txt"
              style="fill:${startOnFill ? 'var(--on-accent)' : 'var(--text)'}">${startTxt}</text>
        <text x="${END_X}" y="37" text-anchor="end" class="df-ov-tank-txt"
              style="fill:${endOnFill ? 'var(--on-accent)' : 'var(--text)'}">${endTxt}</text>
      </svg>
      <div class="df-ov-tank-foot">
        <span class="df-ov-tank-gas">${gasLine}</span>
        ${sacHtml}
      </div>
    </div>`;
}

function _dfSpecRow(iconName, label, val) {
  if (!val) return '';
  return `<div class="df-ov-row"><span class="df-ov-row-ic">${_dfIcon(iconName)}</span><span class="df-ov-row-label">${label}</span><span class="df-ov-row-val">${val}</span></div>`;
}

function renderDiveFile(d) {
  const id        = d.id;
  // String(?? '') rather than (x || ''): a bare "entry:" YAML key parses to
  // [] (parseFrontmatter), which is truthy and has no .replace — throwing on
  // every dive-file open that reaches it. letters-only: feeds class + style contexts
  const entry     = String(d.entry ?? '').replace(/[^A-Za-z]/g, '');
  const marine    = d.marine || [];
  const tripLabel = esc(d.trip || d.region || d.location || '');

  const MONTHS  = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const DAYS    = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const fullDate = (() => {
    if (!d.date) return '';
    const dt = new Date(d.date + 'T00:00:00');
    if (isNaN(dt)) return d.date;
    return `${DAYS[dt.getDay()]} ${dt.getDate()} ${MONTHS[dt.getMonth()]} ${dt.getFullYear()}`;
  })();
  // Mobile: no day-of-week, no country — keeps the meta line single-row
  const mobDate = (() => {
    if (!d.date) return '';
    const dt = new Date(d.date + 'T00:00:00');
    if (isNaN(dt)) return d.date;
    return `${dt.getDate()} ${MONTHS[dt.getMonth()]} ${dt.getFullYear()}`;
  })();
  const mobRegion = d.region || d.location || '';

  // Computed early so band + data cards can share
  const sac      = calcSAC(d);
  const avgDepth = (d.avgdepth && parseFloat(d.avgdepth) > 0) ? d.avgdepth : null;
  const hasGPS   = !isNaN(parseFloat(d.gps_lat)) && !isNaN(parseFloat(d.gps_lng));
  const hasFootage = !!(d.videos && d.videos.length);
  const footageTip = hasFootage ? 'Footage' : 'No footage yet — link video clips to this dive';

  // ── App bar (‹ · trip · 🎬 · ✎ · ⋯)
  const appBar = `
    <div class="df-appbar">
      <button class="df-back-btn" onclick="goBackToHistory(${id})">
        <span class="df-back-arrow">‹</span><span class="df-appbar-title">${tripLabel}</span>
      </button>
      <button class="df-action-btn footage${hasFootage ? '' : ' no-footage'}" onclick="openFootage(${id})" title="${footageTip}">🎬</button>
      <button class="df-action-btn" onclick="openEdit(${id})" title="Edit">✎</button>
      <div class="df-more-wrap">
        <button class="df-action-btn" onclick="dfToggleMore(event,'df-more-${id}')" title="More">⋯</button>
        <div class="df-more-menu" id="df-more-${id}" style="display:none">
          <button class="df-more-item danger" onclick="armDelete(this, () => { closeDiveFile(); deleteDive(${id}); }, 'Confirm delete?')">Delete dive</button>
          <button class="df-more-item" onclick="shareDiveMenu(${id})">Share or save…</button>
        </div>
      </div>
    </div>`;

  // ── Hero (type pill · site · meta)
  // --tc alongside background: read by .tex-halo when the "Also on labelled
  // tags" toggle is on — see the texture-channel CSS block near the theme
  // rules in css/styles.css.
  // background-color, not shorthand — shorthand resets background-image,
  // which would silently clobber [data-tex] (pillTex, below) on this element.
  const typeStyle  = entry ? `style="background-color:var(--type-${entry});--tc:var(--type-${entry})"` : `style="background-color:var(--text-dim)"`;
  const texLblOn   = typeof _texLabelsOn === 'function' && _texLabelsOn();
  const pillTex    = (entry && texLblOn && TYPE_TEXTURE[entry]) ? ` data-tex="${TYPE_TEXTURE[entry]}"` : '';
  const pillClass  = `df-type-pill${texLblOn ? ' tex-halo' : ''}`;
  const heroMeta  = `#${d.divenum || '—'}${mobRegion ? ' · ' + esc(mobRegion) : ''} · ${mobDate}`;
  const deskMeta  = `#${d.divenum || '—'} · ${[d.region, d.location].filter(Boolean).map(esc).join(', ')} · ${fullDate}`;
  // Two meta lines: mobile (short) shown <900px, desktop (full) shown ≥900px via CSS
  const heroInner = `
    ${entry ? `<span class="${pillClass}" ${typeStyle}${pillTex}>${entry}</span>` : ''}
    <div class="df-site">${esc(d.site) || 'Unknown site'}</div>
    <div class="df-meta df-meta-mob">${heroMeta}</div>
    <div class="df-meta df-meta-desk">${deskMeta}</div>`;

  // Shared action buttons (used in hero deskbar for GPS dives, or in deskHead otherwise)
  const deskActsHtml = `
    <div class="df-desk-acts">
      <button class="df-desk-abtn footage${hasFootage ? '' : ' no-footage'}" onclick="openFootage(${id})" title="${footageTip}">🎬 Footage</button>
      <button class="df-desk-abtn" onclick="openEdit(${id})">✎ Edit</button>
      <div class="df-more-wrap">
        <button class="df-desk-abtn" onclick="dfToggleMore(event,'df-more-desk-${id}')">⋯</button>
        <div class="df-more-menu" id="df-more-desk-${id}" style="display:none">
          <button class="df-more-item danger" onclick="armDelete(this, () => { closeDiveFile(); deleteDive(${id}); }, 'Confirm delete?')">Delete dive</button>
          <button class="df-more-item" onclick="shareDiveMenu(${id})">Share or save…</button>
        </div>
      </div>
    </div>`;

  // For GPS dives: hero map is the ambient background on desktop — deskbar overlaid inside it.
  // For no-GPS dives: plain hero (mobile-only text block).
  const hero = hasGPS ? `
    <div class="df-hero df-hero-map" id="df-hero-map-${id}" onclick="if(window.innerWidth<900)dfHeroExpand(${id})">
      <div class="df-hero-overlay">
        <div class="df-hero-deskbar">
          <button class="df-back-link" onclick="goBackToHistory(${id})">‹ Back${tripLabel ? ' to ' + tripLabel : ''}</button>
          ${deskActsHtml}
        </div>
        <div class="df-hero-gradient"></div>
        <div class="df-hero-content">${heroInner}</div>
        <button class="df-hero-close" id="df-hero-close-${id}" onclick="event.stopPropagation();dfHeroCollapse(${id})" style="display:none">✕</button>
      </div>
    </div>` : `
    <div class="df-hero">
      ${heroInner}
    </div>`;

  // Desktop heading: only used for no-GPS dives (hero map replaces it when GPS is present)
  const deskHead = hasGPS ? '' : `
    <div class="df-desk-head">
      <button class="df-back-link" onclick="goBackToHistory(${id})">‹ Back${tripLabel ? ' to ' + tripLabel : ''}</button>
      <div class="df-desk-headrow">
        <div class="df-desk-id">
          ${entry ? `<span class="${pillClass}" ${typeStyle}${pillTex}>${entry}</span>` : ''}
          <div class="df-site" style="margin-top:8px">${esc(d.site) || 'Unknown site'}</div>
          <div class="df-meta">${deskMeta}</div>
        </div>
        ${deskActsHtml}
      </div>
    </div>`;

  // ── Stat band — 3-up on mobile, 5-up on desktop (avg depth + SAC revealed by CSS)
  // Replaced (not duplicated alongside) by the profile chart's own readout
  // strip when this dive has an imported profile — DECISIONS.md → "The
  // floating stat band is replaced, not duplicated, when a profile exists".
  const profileChart = renderProfileChart(d);
  // Hero band — depth/time/vis are the fixed three; avg joins as a 4th cell
  // only when the dive actually has it (not a "—" placeholder taking a slot).
  // SAC used to have its own desktop-only 5th cell here too — removed, since
  // it now lives exclusively in the Overview tank's footer (both mobile and
  // desktop render the same overviewContent) and showing it in both places
  // was a real duplication, not a design choice (found live).
  const band = profileChart || `
    <div class="df-band${avgDepth ? ' df-band-has-avg' : ''}">
      <div class="df-bcell"><div class="df-bn">${d.depth || '—'}</div><div class="df-bl">↓ max m</div></div>
      <div class="df-bcell"><div class="df-bn">${d.time  || '—'}</div><div class="df-bl">⏱ min</div></div>
      <div class="df-bcell"><div class="df-bn">${d.vis   || '—'}</div><div class="df-bl">👁 vis m</div>${_dfVisBarHtml(d.vis)}</div>
      ${avgDepth ? `<div class="df-bcell"><div class="df-bn">${avgDepth}</div><div class="df-bl">avg m</div></div>` : ''}
    </div>`;

  // ── Marine tab — two-column on desktop (carousel left, sighting list right)
  const sp = marine.length ? spBuildPanel(marine, id) : null;
  const marineContent = sp ? `
    <div class="df-marine-grid">
      <div class="df-marine-left">
        <div class="sp-carwrap"><div class="sp-car" id="sp-car-${id}">${sp.slides}</div></div>
        <div class="sp-nav">
          <button class="sp-btn" id="sp-prev-${id}" onclick="spStep(${id},-1)" aria-label="Previous">‹</button>
          <span class="sp-count" id="sp-count-${id}">1 / ${sp.total}</span>
          <button class="sp-btn" id="sp-next-${id}" onclick="spStep(${id},1)" aria-label="Next">›</button>
        </div>
      </div>
      <div class="df-marine-right">
        <div class="df-marine-right-h">Sightings <span class="df-marine-n">${sp.total}</span></div>
        <div class="sp-list" id="sp-list-${id}" data-diveid="${id}">${sp.list}</div>
      </div>
    </div>`
  : `<p class="df-no-marine">No marine life logged on this dive.</p>`;

  // ── Overview data (Conditions / Profile / Gas & equipment / Sign-off) ──
  // One shape, both breakpoints: overviewContent (below) renders inside the
  // mobile Overview tab AND, unchanged, in the desktop journal/overview row
  // further down — no separate desktop dl-list representation any more
  // (the old .df-data-strip circle bubbles are retired; DECISIONS.md).
  const hasNotes = !!(d.title || d.notes);

  const specRows = [
    (!profileChart && (d.entrytime || d.exittime))
      ? _dfSpecRow('clock', 'Entry · exit', [d.entrytime, d.exittime].filter(Boolean).map(esc).join(' → ')) : '',
    (!profileChart && d.safety_stop_depth)
      ? _dfSpecRow('stop', 'Safety stop', `${d.safety_stop_depth} m / ${d.safety_stop_time} min`) : '',
    (d.suit || d.weight)
      ? _dfSpecRow('suit', 'Suit · weight', [d.suit, d.weight ? d.weight + ' kg' : ''].filter(Boolean).map(esc).join(' · ')) : '',
    d.buddy ? _dfSpecRow('buddy', 'Buddy', esc(d.buddy)) : '',
    (d.liveaboard || d.trip)
      ? _dfSpecRow('boat', 'Operator · trip', [d.liveaboard, d.trip].filter(Boolean).map(esc).join('<br>')) : '',
    d.signoff ? _dfSpecRow('pen', 'Sign-off', esc(d.signoff) + (d.certnum ? ' · ' + esc(d.certnum) : '')) : '',
  ].filter(Boolean).join('');

  // A function, not a plain string: overviewContent renders in TWO places at
  // once (the mobile Overview tab AND, unchanged, the desktop journal row —
  // .df-right-col/.df-desk-journal-row hide whichever one the breakpoint
  // doesn't want). A shared string would give the tank's <clipPath id="dftk-
  // ${id}"> the exact same id twice in one document — invalid HTML, and
  // found live to actually break the clip: the fill rendered as a plain
  // unclipped rectangle, square corners visibly poking past the tank's
  // rounded silhouette. ctx makes each render's id genuinely unique.
  const buildOverviewContent = (ctx) => `
    <div class="df-ov">
      ${_dfTempTileHtml(d.temp)}
      <div class="df-ov-grid2">
        ${_dfCurrentTileHtml(d.current)}
        ${_dfWeatherTileHtml(d.weather, d.watertype)}
      </div>
      ${_dfTankHtml(d, id + '-' + ctx, sac)}
      ${specRows ? `<div class="df-ov-rows">${specRows}</div>` : ''}
    </div>`;

  // ── Segmented control (mobile only — desktop uses the two-column layout)
  // A genuine tab strip (switches entire content panels, not a filter/sort
  // state — see CLAUDE.md's own "folder-tab" framing), so role="tablist"/
  // role="tab"/aria-selected is the correct WAI-ARIA pattern here, distinct
  // from the aria-pressed convention used for the segmented-toggle-shaped
  // controls elsewhere (those don't switch content, just which option is
  // chosen).
  const seg = `
    <div class="df-seg" role="tablist">
      <button class="df-seg-btn active" role="tab" aria-selected="true" onclick="dfTab('marine',this)">Marine <span class="df-seg-badge">${marine.length}</span></button>
      <button class="df-seg-btn" role="tab" aria-selected="false" onclick="dfTab('overview',this)">Overview</button>
      ${hasNotes ? `<button class="df-seg-btn" role="tab" aria-selected="false" onclick="dfTab('notes',this)">Journal</button>` : ''}
    </div>`;

  // Structure: the ambient hero map sits OUTSIDE .df-body so it can full-bleed
  // (top + left + right) on desktop, while .df-body holds everything else at a
  // capped, readable width. appBar is mobile-only; deskHead (non-GPS header) goes
  // inside the body. On mobile .df-body is a plain block (no cap) — content just
  // stacks for the segmented tabs.
  return `
    ${appBar}
    ${hero}
    <div class="df-body">
      ${deskHead}
      ${band}
      ${seg}
      <div class="df-left-col">
        <div class="df-panel active" data-tab="marine">${marineContent}</div>
        ${hasNotes ? `<div class="df-panel df-panel--notes-mob" data-tab="notes">${_notesBlockHtml(d)}</div>` : ''}
      </div>
      <div class="df-right-col">
        <div class="df-panel" data-tab="overview">${buildOverviewContent('mob')}</div>
      </div>
      <div class="df-desk-journal-row">
        <div class="df-desk-journal-col">${_notesBlockHtml(d, true)}</div>
        <div class="df-desk-overview-col">${buildOverviewContent('desk')}</div>
      </div>
      <div style="height:28px"></div>
    </div>`;
}

// Render a single Direction D card
function renderTlRow(d) {
  // String(?? '') rather than (x || ''): a bare "entry:" YAML key parses to
  // [] (parseFrontmatter), which is truthy and has no .replace — this runs
  // on every timeline row, so that throw would have taken out the whole list.
  const entry       = String(d.entry ?? '').replace(/[^A-Za-z]/g, ''); // letters-only: feeds class context
  const spineClass  = entry ? `dD-spine t-${entry}` : 'dD-spine';
  const texLblOn    = typeof _texLabelsOn === 'function' && _texLabelsOn();
  const spineTex    = (entry && texLblOn && TYPE_TEXTURE[entry]) ? ` data-tex="${TYPE_TEXTURE[entry]}"` : '';
  const spineSpanCl = (entry && texLblOn) ? ' class="tex-halo"' : '';
  const gpsPin     = (d.gps_lat && d.gps_lng) ? ' 📍' : '';
  const pendingDot = (d._pendingSync && syncMode === 'obsidian')
    ? ' <span class="tl-pending" title="Not yet synced to the vault">●</span>' : '';

  // "Wed 13 May 2026"
  const fullDate = (() => {
    if (!d.date) return '';
    const dt = new Date(d.date + 'T00:00:00');
    if (isNaN(dt)) return d.date;
    const DAYS   = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return `${DAYS[dt.getDay()]} ${dt.getDate()} ${MONTHS[dt.getMonth()]} ${dt.getFullYear()}`;
  })();

  // Three measurement rows — only rendered when the value is present
  const measHtml = [
    d.depth ? `<span class="dD-mi">↓</span><span class="dD-mn">${d.depth}</span><span class="dD-mu">m</span>` : '',
    d.time  ? `<span class="dD-mi">⏱</span><span class="dD-mn">${d.time}</span><span class="dD-mu">min</span>` : '',
    d.vis   ? `<span class="dD-mi vis">👁</span><span class="dD-mn vis">${d.vis}</span><span class="dD-mu">m</span>` : '',
  ].join('');

  // Rarest-species thumbnail (square iNat photo or group emoji fallback)
  const rare       = rarestSighting(d);
  const spCount    = (d.marine || []).length;
  const thumbInner = (() => {
    if (!rare) return `<span class="dD-thumb-ph">🤿</span>`;
    const url   = SP_PHOTO_MAP[rare.scientificName] || '';
    const emoji = GROUP_EMOJI[rare.group] || '🐟';
    return url
      ? `<img src="${url}" alt="" loading="lazy">`
      : `<span class="dD-thumb-ph">${emoji}</span>`;
  })();

  // Passive footage indicator (▶ count) — only when videos are linked
  const linkedVids = new Set((d.marine || []).flatMap(m => _sightingClips(m).map(c => c.video))).size;
  const hasVids    = d.videos && d.videos.length;

  // Desktop: species name (rarest) shown alongside count
  const rareName = rare ? esc(rare.commonName || rare.scientificName || '') : '';

  // Glimpse — title, first-sentence snippet, or rarest species name
  const glimpse = _diveGlimpse(d);

  // Bulk selection (v2.89) — while active, the whole card toggles selection
  // instead of opening the dive file, and the per-card edit/footage/delete
  // actions are hidden (this is a batch-admin mode, not a place to also
  // start mutating one dive at a time). The checkbox sits as a direct child
  // of .dD-card, positioned once via CSS, so one element covers both the
  // mobile .dD-content and desktop .dh-* layouts instead of duplicating it.
  const selecting  = _selectMode;
  const isSelected = _selectedDiveIds.has(d.id);
  const cardClass  = 'dD-card' + (selecting ? ' selectable' : '') + (isSelected ? ' selected' : '');
  const cardClick  = selecting ? `_toggleDiveSelect(${d.id})` : `openDiveFile(${d.id})`;
  const selectBox  = selecting ? `<div class="dD-select-box${isSelected ? ' checked' : ''}" aria-hidden="true"></div>` : '';

  return `
    <div class="${cardClass}" id="wrap-${d.id}" onclick="${cardClick}">
      ${selectBox}
      <div class="${spineClass}"${spineTex}><span${spineSpanCl}>${entry || '—'}</span></div>

      <!-- Mobile layout (hidden on desktop) -->
      <div class="dD-content">
        <div class="dD-identity">
          <div class="dD-site">${esc(d.site) || 'Unknown site'}${gpsPin}${pendingDot}</div>
          <div class="dD-date">${fullDate}</div>
          <div class="dD-dnum"><span class="dD-dnum-n">#${d.divenum || '—'}</span><span class="dD-dnum-c"> · ${spCount} sp.${hasVids ? ` ▶${linkedVids}` : ''}</span></div>
        </div>
        <div class="dD-meas">${measHtml}</div>
        <div class="dD-marine">
          <div class="dD-thumb">${thumbInner}</div>
          ${glimpse.text ? `<div class="dD-glimpse ${glimpse.kind}">${esc(glimpse.text)}</div>` : ''}
          ${selecting ? '' : `<button class="dD-edit" onclick="event.stopPropagation();openEdit(${d.id})" title="Edit dive">✎</button>`}
        </div>
      </div>

      <!-- Desktop columns (hidden on mobile, grid cells on desktop) -->
      <div class="dh-id">
        <div class="dh-site">${esc(d.site) || 'Unknown site'}${gpsPin}${pendingDot}</div>
        ${glimpse.text ? `<div class="dh-glimpse ${glimpse.kind}">${esc(glimpse.text)}</div>` : ''}
        <div class="dh-sub"><strong>#${d.divenum || '—'}</strong><span class="dh-sub-date"> · ${fullDate}</span></div>
      </div>
      <div class="dh-m">${d.depth ? `<span class="ic">↓</span><span class="n">${d.depth}</span><span class="u">m</span>` : ''}</div>
      <div class="dh-m">${d.time  ? `<span class="ic">⏱</span><span class="n">${d.time}</span><span class="u">min</span>` : ''}</div>
      <div class="dh-m vis">${d.vis ? `<span class="ic">👁</span><span class="n">${d.vis}</span><span class="u">m</span>` : ''}</div>
      <div class="dh-marine">
        <div class="dh-thumb">${thumbInner}</div>
        <div class="dh-mtxt">
          ${rareName ? `<div class="dh-mname">${rareName}</div>` : ''}
          <div class="dh-mcount">🐟 ${spCount} sp.${hasVids ? ` <span class="dh-vid-count">▶ ${linkedVids}</span>` : ''}</div>
        </div>
      </div>
      ${selecting ? '' : `<div class="dh-acts">
        <button class="dh-abtn footage${hasVids ? '' : ' no-footage'}" onclick="event.stopPropagation();openFootage(${d.id})" title="${hasVids ? 'Footage' : 'No footage yet — link video clips to this dive'}">🎬</button>
        <button class="dh-abtn" onclick="event.stopPropagation();openEdit(${d.id})" title="Edit">✎</button>
        <button class="dh-abtn del" onclick="event.stopPropagation();armDelete(this, () => deleteDive(${d.id}))" title="Delete — click again to confirm">🗑</button>
      </div>`}
    </div>`;
}

// ── Lazy-init trip maps (Phase 2.21) ──────────────────────────────────────
// Ambient recognition banners — one per trip/country group that has ≥1 GPS
// dive. Built only when the container scrolls into view (IntersectionObserver),
// torn down on every re-render. Non-interactive (the Map button is the real map).

const _tripMaps = {};        // container id → Leaflet instance
let _tripMapObserver = null;

// Build the map container HTML for a group, or '' when no GPS dives.
// data-coords carries marker positions for the ambient banner (numbers only
// — no injection risk); data-uids carries the same dives' stable IDs so the
// full-screen view (openTripMapView) can look up the real dive objects and
// reuse renderMapMarkers' actual popups instead of a bare position dot.
// Tappable — real-user testing found people expected to pinch/zoom this
// ambient banner directly and were surprised it did nothing.
function _tripMapHtml(groupDives, idSuffix, title) {
  const mapped = groupDives.filter(d => !isNaN(parseFloat(d.gps_lat)) && !isNaN(parseFloat(d.gps_lng)));
  if (!mapped.length) return '';
  const coords = mapped.map(d => [parseFloat(d.gps_lat), parseFloat(d.gps_lng)]);
  const uids   = mapped.map(d => d.uid).filter(Boolean);
  const titleAttr = esc(title || 'Trip map');
  return `<div class="tl-trip-map" id="trip-map-${idSuffix}" data-coords='${JSON.stringify(coords)}'
    data-uids='${JSON.stringify(uids)}' data-title="${titleAttr}" onclick="openTripMapView(this)">
    <span class="tl-trip-map-expand" aria-hidden="true">⤢</span>
  </div>`;
}

// Disconnect observer + remove all live trip-map instances (before a re-render)
function _teardownTripMaps() {
  if (_tripMapObserver) { _tripMapObserver.disconnect(); _tripMapObserver = null; }
  Object.keys(_tripMaps).forEach(k => {
    try { _tripMaps[k].remove(); } catch(e) {}
    delete _tripMaps[k];
  });
}

// Wire lazy-init on every .tl-trip-map in the DOM. Hides all when offline.
function _initTripMaps() {
  const containers = document.querySelectorAll('.tl-trip-map[data-coords]');
  if (!containers.length) return;
  if (!navigator.onLine) { containers.forEach(c => c.style.display = 'none'); return; }
  _tripMapObserver = new IntersectionObserver((entries) => {
    entries.forEach(e => {
      if (!e.isIntersecting) return;
      _tripMapObserver.unobserve(e.target);
      _buildTripMap(e.target);
    });
  }, { rootMargin: '120px' });
  containers.forEach(c => _tripMapObserver.observe(c));
}

function _buildTripMap(el) {
  if (_tripMaps[el.id]) return;
  let coords;
  try { coords = JSON.parse(el.dataset.coords); } catch(e) { return; }
  if (!coords || !coords.length) return;
  loadLeaflet().then(() => {
    if (_tripMaps[el.id]) return; // guard double-init
    try {
      // Ambient banner — all interaction disabled (recognition, not navigation)
      const map = L.map(el, {
        zoomControl: false, attributionControl: false,
        dragging: false, scrollWheelZoom: false, doubleClickZoom: false,
        boxZoom: false, keyboard: false, touchZoom: false,
      });
      _tripMaps[el.id] = map;
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18 }).addTo(map);
      coords.forEach(c => L.circleMarker(c, {
        radius: 5, fillColor: '#4A90B8', color: '#fff', weight: 1.5, fillOpacity: 0.9
      }).addTo(map));
      if (coords.length === 1) map.setView(coords[0], 9);
      else map.fitBounds(coords, { padding: [24, 24] });
      setTimeout(() => map.invalidateSize(), 60);
    } catch(e) {
      el.style.display = 'none';
    }
  }).catch(() => { el.style.display = 'none'; });
}

// ── Full-screen view-only trip map ──────────────────────────────────────────
// The ambient banner above is deliberately non-interactive; real-user testing
// found people tapped it expecting to pinch/zoom directly regardless. This
// opens the same pins full-screen in a fresh, fully-interactive Leaflet
// instance — pan/zoom only, no pin placement or editing, no marker dragging.
// Shares the .map-modal shell with the log form's pin picker (js/logform.js).
let _tlMapView = null; // truthy while open or opening — also the map-instance holder

function _tlMapModalEl() {
  let ov = document.getElementById('tl-map-modal');
  if (!ov) {
    ov = document.createElement('div');
    ov.id = 'tl-map-modal';
    ov.className = 'map-modal';
    ov.innerHTML =
      '<div class="map-modal-head">' +
        '<span class="map-modal-title" id="tl-map-modal-title"></span>' +
        '<button type="button" class="map-modal-close" onclick="closeTripMapView()">✕</button>' +
      '</div>' +
      '<div class="map-modal-body"><div id="tl-map-modal-canvas" style="flex:1;min-height:0"></div></div>';
    document.body.appendChild(ov);
  }
  return ov;
}

function openTripMapView(el) {
  if (_tlMapView) return; // already open or opening — ignore a fast second tap
  let uids;
  try { uids = JSON.parse(el.dataset.uids); } catch (e) { return; }
  if (!uids || !uids.length) return;
  const tripDives = dives.filter(d => uids.includes(d.uid));
  if (!tripDives.length) return;
  _tlMapView = {}; // claim immediately, before the async Leaflet load resolves
  const ov = _tlMapModalEl();
  const titleEl = document.getElementById('tl-map-modal-title');
  if (titleEl) titleEl.textContent = el.dataset.title || 'Trip map';
  ov.classList.add('open');
  if (typeof _pushOverlayState === 'function') _pushOverlayState({ type: 'tripMap' });
  if (typeof _lockScroll === 'function') _lockScroll();
  loadLeaflet().then(() => {
    if (!_tlMapView) return; // closed again before this resolved
    const canvas = document.getElementById('tl-map-modal-canvas');
    if (!canvas) return;
    const map = L.map(canvas, { zoomControl: true, scrollWheelZoom: false });
    _tlMapView.map = map;
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>', maxZoom: 18
    }).addTo(map);
    renderMapMarkers(map, tripDives); // same marker + popup + bounds-fit logic as History's own Map view
    setTimeout(() => map.invalidateSize(), 60);
  }).catch(() => { closeTripMapView(); }); // goes through the overlay stack, not *Direct() — keeps history state in sync
}

function closeTripMapView() {
  if (typeof closeTopOverlay === 'function') closeTopOverlay();
}

// Called only from the popstate handler (app.js _closeOverlayDirect).
function closeTripMapViewDirect() {
  const ov = document.getElementById('tl-map-modal');
  if (ov) ov.classList.remove('open');
  if (_tlMapView && _tlMapView.map) { try { _tlMapView.map.remove(); } catch (e) {} }
  _tlMapView = null;
  if (typeof _unlockScroll === 'function') _unlockScroll();
}

// Render grouped trip timeline (default sort only)
function renderTripTimeline(sorted) {
  const groups = groupDivesByTrip(sorted);
  return groups.map((group, gi) => {
    const monthStr   = tlMonthRange(group.dives);
    const whereStr   = tlWhereStr(group);
    const spCount    = tlSpeciesCount(group.dives);
    const daySpan    = tlDaySpan(group.dives);
    const diveCount  = group.dives.length;

    // Determine whether this is a named trip or a region/location fallback
    const isNamedTrip = group.dives[0].trip && group.dives[0].trip.trim();
    const headerName  = group.key;
    const headerWhere = isNamedTrip
      ? [whereStr, monthStr].filter(Boolean).join(' · ')
      : monthStr; // region/location groups: just show the month

    const statsStr = [
      diveCount + ' dive' + (diveCount !== 1 ? 's' : ''),
      spCount  ? spCount + ' sp.' : '',
      daySpan > 1 ? daySpan + ' days' : '',
    ].filter(Boolean).join(' · ');

    return `<div class="tl-group">
      <div class="tl-header">
        <div class="tl-header-label">
          <span class="tl-trip-name">${esc(headerName)}</span>
          <button class="tl-rename" data-key="${esc(group.key)}" data-named="${isNamedTrip ? 1 : 0}"
            onclick="startTripRename(this)" title="${isNamedTrip ? 'Rename trip' : 'Name this trip'}">✎</button>
          ${headerWhere ? `<span class="tl-trip-where">${esc(headerWhere)}</span>` : ''}
        </div>
        <div class="tl-leaders"></div>
        <div class="tl-trip-stats">${statsStr}</div>
      </div>
      ${_tripMapHtml(group.dives, 'trip-' + gi, headerName)}
      ${group.dives.map(renderTlRow).join('')}
    </div>`;
  }).join('');
}

// ── Rename trip (Phase D — ROADMAP "Rename trip action") ───────────────────
// Inline rename on the trip header. Enter commits, Escape/blur cancels —
// a rename rewrites every .md in the group, so it must be deliberate.
// Filenames don't change (dive-NUM-site), so uid/sidecar joins are unaffected.
function startTripRename(btn) {
  const header = btn.closest('.tl-header');
  if (!header || header.querySelector('.tl-rename-input')) return;
  const label   = header.querySelector('.tl-header-label');
  const key     = btn.dataset.key;
  const isNamed = btn.dataset.named === '1';

  const wrap = document.createElement('span');
  wrap.className = 'tl-rename-wrap';
  const input = document.createElement('input');
  input.type        = 'text';
  input.className   = 'tl-rename-input';
  input.value       = isNamed ? key : '';
  input.placeholder = isNamed ? 'Trip name' : 'Name this trip…';
  const ok = document.createElement('button');
  ok.type = 'button'; ok.className = 'tl-rename-ok';     ok.textContent = '✓'; ok.title = 'Save (Enter)';
  const no = document.createElement('button');
  no.type = 'button'; no.className = 'tl-rename-cancel'; no.textContent = '✕'; no.title = 'Cancel (Esc)';
  wrap.append(input, ok, no);
  label.style.display = 'none';
  btn.style.display   = 'none';
  header.insertBefore(wrap, header.querySelector('.tl-leaders'));
  input.focus();
  input.select();

  let finished = false; // wrap.remove() fires blur — guard double-finish
  const done = (commit) => {
    if (finished) return;
    finished = true;
    const val = input.value;
    wrap.remove();
    label.style.display = '';
    btn.style.display   = '';
    if (commit) commitTripRename(key, val);
  };
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter')  { e.preventDefault(); done(true);  }
    if (e.key === 'Escape') { e.preventDefault(); done(false); }
  });
  // mousedown would blur the input (= cancel) before the click lands — block it
  ok.addEventListener('mousedown', e => e.preventDefault());
  no.addEventListener('mousedown', e => e.preventDefault());
  ok.addEventListener('click', () => done(true));
  no.addEventListener('click', () => done(false));
  input.addEventListener('blur', () => done(false));
}

async function commitTripRename(key, newName) {
  newName = (newName || '').trim();
  if (!newName || newName === key) { renderHistory(); return; }
  // Re-derive membership with the same rule groupDivesByTrip uses
  const group = dives.filter(d =>
    (d.trip || d.region || d.location || 'Ungrouped').trim() === key);
  if (!group.length) return;
  await _applyTripToDiveList(group, newName);
}

// Shared by the trip-header rename above and the bulk-select action bar
// (below) — the only difference between the two call sites is how
// diveList is derived (a whole existing group vs. an arbitrary checkbox
// selection); persisting and re-pushing is identical either way.
async function _applyTripToDiveList(diveList, newName) {
  diveList.forEach(d => { d.trip = newName; d._pendingSync = true; });
  localStorage.setItem('divelog-dives', JSON.stringify(dives));
  acSave('trip', newName); // autocomplete learns the new name
  renderHistory();

  // Re-write each dive's .md on the active backend
  if (syncMode === 'obsidian' && typeof obsAvailable !== 'undefined' && obsAvailable) {
    for (const d of diveList) {
      try { await pushToObsidian(d); } catch (e) { /* stays _pendingSync */ }
    }
    // pushToObsidian's debounced render clears the pending dots after the
    // last push — no explicit renderHistory here (it would double-render)
  } else if (syncMode === 'folder') {
    for (const d of diveList) {
      try { await writeToFolder(d); } catch (e) { /* file keeps old trip until next sync */ }
    }
  }
}

// ── Bulk selection ───────────────────────────────────────────────────────
// Enter/exit is the only transition that needs a full renderHistory() — the
// checkbox markup and each card's onclick target (openDiveFile vs.
// _toggleDiveSelect) are baked into the rendered HTML string in renderTlRow,
// so they can only change on a re-render. Every tap WITHIN selection mode
// is handled by _syncSelectionDom() instead (toggle a couple of classes),
// both because a full re-render on every tap would feel laggy and because
// it would tear down/rebuild the lazy trip maps for no reason.
function toggleSelectMode(on, action = 'trip') {
  _selectMode = on;
  _selectAction = action;
  _selectedDiveIds = new Set();
  _selectAnchorId = null;
  const sortToolbar   = document.getElementById('sort-toolbar');
  const actionsRow    = document.getElementById('hist-actions-row');
  const selectToolbar = document.getElementById('select-toolbar');
  if (sortToolbar)   sortToolbar.style.display   = on ? 'none' : '';
  if (actionsRow)    actionsRow.style.display    = on ? 'none' : '';
  if (selectToolbar) selectToolbar.style.display = on ? '' : 'none';
  // 'contents' (not '') when shown — #select-toolbar is display:flex and
  // both action wrappers' children (the trip input+dropdown+Apply button;
  // the divenum label+input+error+Apply button) are meant to sit as direct
  // flex-row items exactly as they did before this div existed. 'contents'
  // makes the wrapper itself generate no box, so its children lay out as
  // if they were direct children of #select-toolbar; plain 'block'/'' would
  // pull them out of the flex row into their own stacked line instead.
  const tripActionEl    = document.getElementById('select-action-trip');
  const divenumActionEl = document.getElementById('select-action-divenum');
  if (tripActionEl)    tripActionEl.style.display    = (on && action === 'trip')    ? 'contents' : 'none';
  if (divenumActionEl) divenumActionEl.style.display = (on && action === 'divenum') ? 'contents' : 'none';
  const tripInput = document.getElementById('select-trip-input');
  if (tripInput) tripInput.value = '';
  const deltaInput = document.getElementById('select-divenum-delta');
  if (deltaInput) deltaInput.value = '';
  renderHistory();
  _updateSelectBar();
}

// Current on-screen dive order, read straight from the DOM rather than
// re-deriving sort/group logic here — makes range-select correct under
// whichever sort/grouping is currently rendered with zero duplicated rules,
// and automatically consistent if either ever changes independently.
function _historyDomOrder() {
  return Array.from(document.querySelectorAll('#history-list .dD-card'))
    .map(el => Number(el.id.slice(5))); // 'wrap-123' → 123
}

// Tap an unselected dive → single-select + becomes the anchor. Tap another
// unselected dive → REPLACES the selection with the inclusive range between
// the anchor and this dive (anchor stays fixed, mirrors shift-click, just
// without needing a modifier key — the two-tap gesture works identically on
// touch and mouse). Tap an already-selected dive → deselects just that one
// and drops the anchor, so the next tap starts a fresh range rather than
// extending from a now-ambiguous point.
function _toggleDiveSelect(id) {
  if (_selectedDiveIds.has(id)) {
    _selectedDiveIds.delete(id);
    if (_selectAnchorId === id) _selectAnchorId = null;
  } else if (!_selectedDiveIds.size || _selectAnchorId == null) {
    _selectedDiveIds = new Set([id]);
    _selectAnchorId = id;
  } else {
    const order = _historyDomOrder();
    const ai = order.indexOf(_selectAnchorId);
    const bi = order.indexOf(id);
    if (ai === -1 || bi === -1) {
      _selectedDiveIds = new Set([id]);
      _selectAnchorId = id;
    } else {
      const [lo, hi] = ai < bi ? [ai, bi] : [bi, ai];
      _selectedDiveIds = new Set(order.slice(lo, hi + 1));
    }
  }
  _syncSelectionDom();
}

function _syncSelectionDom() {
  document.querySelectorAll('#history-list .dD-card').forEach(el => {
    const sel = _selectedDiveIds.has(Number(el.id.slice(5)));
    el.classList.toggle('selected', sel);
    const box = el.querySelector('.dD-select-box');
    if (box) box.classList.toggle('checked', sel);
  });
  _updateSelectBar();
}

function _updateSelectBar() {
  const countEl = document.getElementById('select-count');
  if (countEl) countEl.textContent = _selectedDiveIds.size
    ? `${_selectedDiveIds.size} selected`
    : 'Tap a dive, then tap another to select the range between';

  if (_selectAction === 'divenum') {
    const deltaInput = document.getElementById('select-divenum-delta');
    const applyBtn   = document.getElementById('select-divenum-apply-btn');
    const errorEl    = document.getElementById('select-divenum-error');
    const delta = parseInt(deltaInput && deltaInput.value, 10);
    const validInput = _selectedDiveIds.size && Number.isFinite(delta) && delta !== 0;
    const collisions = validInput ? _divenumShiftCollisions(delta) : [];
    if (errorEl) errorEl.textContent = collisions.length ? `Would collide: ${collisions.join(', ')}` : '';
    if (applyBtn) applyBtn.disabled = !validInput || !!collisions.length;
    return;
  }
  const tripInput = document.getElementById('select-trip-input');
  const applyBtn  = document.getElementById('select-apply-btn');
  if (applyBtn) applyBtn.disabled = !_selectedDiveIds.size || !(tripInput && tripInput.value.trim());
}

// Enter accepts a focused autocomplete suggestion first (matching every
// other AC-backed field) — only applies the bulk trip once the dropdown has
// nothing left to consume, same "first Enter picks, second Enter commits"
// behaviour browsers already give native autofill.
function _selectTripInputKey(e) {
  acKey(e, 'select-trip-input');
  if (e.key === 'Enter' && !e.defaultPrevented) applyBulkTrip();
}

// Clears the selection (not selection mode itself) so the next batch can be
// picked immediately — "tackle one trip at a time" means Apply is called
// repeatedly without leaving selection mode between batches.
async function applyBulkTrip() {
  const input = document.getElementById('select-trip-input');
  const newName = (input && input.value || '').trim();
  if (!newName || !_selectedDiveIds.size) return;
  const diveList = dives.filter(d => _selectedDiveIds.has(d.id));
  _selectedDiveIds = new Set();
  _selectAnchorId = null;
  if (input) input.value = '';
  await _applyTripToDiveList(diveList, newName); // renders with _selectMode still on
  _updateSelectBar();
}

// ── Bulk renumber (Dive Number bulk-edit action) ────────────────────────
// Same tap-to-select-a-range selection as Trip Name above; only the applied
// action differs. Born from a human miscounting a dive number (e.g. logging
// the 71st real dive as "#72") and only noticing dozens of dives later, with
// no way to fix it but editing every affected dive one at a time — see
// DECISIONS.md.

// Every human-readable collision this shift would cause, or [] if safe.
// Checked against every dive NOT in the current selection — the selection
// can be an arbitrary on-screen range (e.g. picked while sorted by depth or
// country), not necessarily a numerically contiguous block, so "below/above
// a threshold" isn't the right frame; "does this land on a number some
// OTHER, unselected dive already holds" is. Also rejects landing below #1.
// Dives with a blank/non-numeric divenum are skipped on both sides —
// nothing to collide with, nothing to shift.
function _divenumShiftCollisions(delta) {
  const selected = dives.filter(d => _selectedDiveIds.has(d.id));
  const others = new Set(
    dives.filter(d => !_selectedDiveIds.has(d.id)).map(d => parseInt(d.divenum, 10)).filter(Number.isFinite)
  );
  const bad = [];
  for (const d of selected) {
    const cur = parseInt(d.divenum, 10);
    if (!Number.isFinite(cur)) continue;
    const next = cur + delta;
    if (next < 1 || others.has(next)) bad.push(`#${cur}→${next}`);
  }
  return bad;
}

// Mirrors _applyTripToDiveList's shape (mutate, persist locally, push
// sequentially — never parallel, Android SAF dislikes write storms) with
// divenum instead of trip. Kept as a sibling rather than folded into that
// function: the two mutations differ enough (parseInt+arithmetic vs a
// plain string set) that sharing a body would need a branch inside it
// anyway — the shared PATTERN is what's reused, not literal shared code.
// Renumbering a dive changes canonicalFilename() (js/app.js) for it, so
// writeToFolder/pushToObsidian's own existing drift-check already triggers
// the coordinated rename (_cleanupOldDiveFiles) per dive — no new
// file-rename code needed here at all.
async function _applyDivenumShiftToDiveList(diveList, delta) {
  diveList.forEach(d => { d.divenum = parseInt(d.divenum, 10) + delta; d._pendingSync = true; });
  localStorage.setItem('divelog-dives', JSON.stringify(dives));
  renderHistory();
  if (syncMode === 'obsidian' && typeof obsAvailable !== 'undefined' && obsAvailable) {
    for (const d of diveList) {
      try { await pushToObsidian(d); } catch (e) { /* stays _pendingSync */ }
    }
  } else if (syncMode === 'folder') {
    for (const d of diveList) {
      try { await writeToFolder(d); } catch (e) { /* file keeps old number until next sync */ }
    }
  }
}

// Clears the selection (not selection mode) on success, same "tackle one
// batch at a time" UX as applyBulkTrip. _updateSelectBar already disables
// Apply whenever _divenumShiftCollisions is non-empty — the check here is
// belt-and-suspenders against a stale/re-fired click, not the primary guard.
async function applyBulkRenumber() {
  const input = document.getElementById('select-divenum-delta');
  const delta = parseInt(input && input.value, 10);
  if (!Number.isFinite(delta) || delta === 0 || !_selectedDiveIds.size) return;
  if (_divenumShiftCollisions(delta).length) return;
  const diveList = dives.filter(d => _selectedDiveIds.has(d.id));
  _selectedDiveIds = new Set();
  _selectAnchorId = null;
  if (input) input.value = '';
  await _applyDivenumShiftToDiveList(diveList, delta); // renders with _selectMode still on
  _updateSelectBar();
}

// Flat timeline — no grouping headers, just sorted rows (used by depth sort)
function renderFlatTimeline(sorted) {
  return `<div class="tl-group">${sorted.map(renderTlRow).join('')}</div>`;
}

// Country-grouped timeline — one group per country (used by country sort)
function renderCountryTimeline(sorted) {
  const groupMap = {};
  const groupOrder = [];
  sorted.forEach(d => {
    const key = d.location || 'Unknown';
    if (!groupMap[key]) { groupMap[key] = []; groupOrder.push(key); }
    groupMap[key].push(d);
  });
  return groupOrder.map((country, gi) => {
    const divs     = groupMap[country];
    const spCount  = tlSpeciesCount(divs);
    const diveCount = divs.length;
    const statsStr = [
      diveCount + ' dive' + (diveCount !== 1 ? 's' : ''),
      spCount ? spCount + ' sp.' : '',
    ].filter(Boolean).join(' · ');
    return `<div class="tl-group">
      <div class="tl-header">
        <div class="tl-header-label">
          <span class="tl-trip-name">${esc(country)}</span>
        </div>
        <div class="tl-leaders"></div>
        <div class="tl-trip-stats">${statsStr}</div>
      </div>
      ${_tripMapHtml(divs, 'country-' + gi, country)}
      ${divs.map(renderTlRow).join('')}
    </div>`;
  }).join('');
}

function renderHistory() {
  const el    = document.getElementById('history-list');
  const pgTop = document.getElementById('history-pagination-top');
  const pgBot = document.getElementById('history-pagination-bottom');
  pgTop.style.display = pgBot.style.display = 'none'; // no pagination in timeline views

  _teardownTripMaps(); // remove any live maps before the DOM is replaced

  if (!dives.length) {
    el.innerHTML = '<div class="empty"><strong>No dives logged yet</strong>Log your first dive to see it here.</div>';
    return;
  }

  const sorted = getSortedDives();

  if (sortKey === 'num')          el.innerHTML = renderTripTimeline(sorted);
  else if (sortKey === 'depth')   el.innerHTML = renderFlatTimeline(sorted);
  else if (sortKey === 'country') el.innerHTML = renderCountryTimeline(sorted);

  _initTripMaps(); // lazy-wire the new map containers
}
