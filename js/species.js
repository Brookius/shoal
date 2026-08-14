// Species search, browse, sightings — extracted from index.html (modular migration, step 8).
// Classic script, loaded before the main inline script (shared global scope).
// migrateAbundance() definition is here; its boot-time call stays in the inline script
// (needs dives[], which is initialised there).

// Each entry: [commonName, scientificName, aphiaId, group]

// ── Custom-species registry ───────────────────────────────────────────────
// Stable mapping from cs_xxxx → { commonName, scientificName, group, aphiaId }.
// Free-text species get a customId minted once; subsequent entries with the
// same name (case-insensitive) reuse the same id so the album join is stable.
// Mirrored to localStorage; vault read/write is deferred to the sidecar phase.
let customRegistry = JSON.parse(localStorage.getItem('divelog-custom-species') || '{}');

function _saveRegistry() {
  localStorage.setItem('divelog-custom-species', JSON.stringify(customRegistry));
}

// Return the customId for a free-text name, minting a new one if needed.
function resolveCustomId(name) {
  const norm = name.trim();
  for (const [id, e] of Object.entries(customRegistry)) {
    if ((e.commonName || '').toLowerCase() === norm.toLowerCase()) return id;
  }
  const id = mintCustomId();
  customRegistry[id] = { commonName: norm, scientificName: '', group: '', aphiaId: null };
  _saveRegistry();
  return id;
}

// Backfill registry from a list of parsed dives — runs after sync/import.
// Two cases handled:
//   1. Sighting already has a customId (from another device/session) → ensure
//      it's in the local registry.
//   2. Sighting is free-text (no aphiaId, not validated) but has no customId
//      yet (saved before 2.32) → mint one now and stamp it on the sighting
//      in-place, so the next "Push all" writes it to the vault file.
function _backfillRegistry(diveList) {
  for (const dive of diveList) {
    for (const m of (dive.marine || [])) {
      if (m.customId) {
        // Already has an id — ensure it's reflected in the local registry
        if (!customRegistry[m.customId]) {
          customRegistry[m.customId] = {
            commonName:     m.commonName     || m.scientificName || '',
            scientificName: m.scientificName || '',
            group:          m.group          || '',
            aphiaId:        null,
          };
          _saveRegistry();
        }
      } else if (!m.aphiaId && !m.validated) {
        // Free-text sighting with no customId yet — mint one and stamp it
        const name = (m.commonName || m.scientificName || '').trim();
        if (name) m.customId = resolveCustomId(name); // resolveCustomId saves registry
      }
    }
  }
}

// Export every distinct free-text (unvalidated) species logged across all
// dives as a CSV — the raw candidate list for the species-batch-expansion
// workflow (research each one against WoRMS/OBIS, then merge the vetted
// result into data/species-db.js). Groups by customId rather than by name
// text, since that's the actual dedup key the app already uses; sightingCount
// is a rough "how often has this actually been logged" signal for
// prioritising which candidates are worth the research effort first.
async function exportUnvalidatedSpecies(btn) {
  if (!dives.length) { showToast('No dives to scan.'); return; }

  const byId = {};
  for (const d of dives) {
    for (const m of (d.marine || [])) {
      if (m.validated || m.aphiaId) continue; // only genuinely free-text sightings
      const id = m.customId || ('_' + (m.commonName || m.scientificName || '').trim().toLowerCase());
      if (!id.replace(/^_/, '')) continue; // nothing to key on — skip
      if (!byId[id]) {
        const reg = customRegistry[m.customId] || {};
        byId[id] = {
          commonName:     m.commonName     || reg.commonName     || '',
          scientificName: m.scientificName || reg.scientificName || '',
          group:          m.group          || reg.group          || '',
          count: 0,
        };
      }
      const e = byId[id];
      if (!e.commonName && m.commonName) e.commonName = m.commonName;
      if (!e.scientificName && m.scientificName) e.scientificName = m.scientificName;
      if (!e.group && m.group) e.group = m.group;
      e.count++;
    }
  }

  const rows = Object.entries(byId).sort((a, b) => b[1].count - a[1].count);
  if (!rows.length) { showToast('No unvalidated species found — everything logged is already matched to the database.', { variant: 'success' }); return; }

  const esc = v => /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  const header = ['commonName', 'scientificName', 'group', 'sightingCount', 'customId'];
  const lines = [header.join(',')];
  for (const [id, e] of rows) {
    lines.push([e.commonName, e.scientificName, e.group, e.count, id].map(v => esc(String(v))).join(','));
  }

  const stamp = new Date().toISOString().slice(0, 10);
  const filename = `unvalidated-species-${stamp}.csv`;
  const csvText = lines.join('\n');
  const statusEl = document.getElementById('export-unvalidated-status');

  // downloadBlob()'s <a download> + blob-URL trick silently no-ops in
  // WKWebView (the native webview the Tauri shell uses on macOS) instead of
  // erroring — it never triggers a real save. Same three-backend split the
  // rest of the app already uses for file output (see exportAllDives()).
  if (isShell()) {
    const path = await window.__TAURI__.core.invoke('save_file_dialog', { title: 'Save unvalidated species', defaultName: filename }).catch(() => null);
    if (!path) return; // user cancelled
    try {
      // save_file_dialog already returns the right STRING on Android — a
      // content://… URI is exactly what the dialog plugin's FilePath::Url
      // stringifies to. write_text_file is pure std::fs and has no concept
      // of a content URI, so the native dialog opened fine but the write
      // behind it always failed. Found in the isShell() audit
      // (BRIEF-play-store-readiness.md §2.10) — android_write_uri
      // (src-tauri/src/androidfs.rs) is the write this actually needs.
      if (isAndroidShell()) {
        await window.__TAURI__.core.invoke('android_write_uri', { uri: path, content: csvText });
      } else {
        await window.__TAURI__.core.invoke('write_text_file', { path, content: csvText });
      }
    } catch (e) {
      showToast('Could not save the file: ' + e, { variant: 'error' });
      return;
    }
    // Android's returned URI ends in an opaque document id, not a filename —
    // nothing meaningful to split out of it (same shape as the Drive folder
    // name bug fixed earlier tonight). Show the name we already asked the
    // dialog to use instead of trying to parse one back out.
    const shownName = isAndroidShell() ? filename : path.split('/').pop();
    if (statusEl) statusEl.textContent = `✓ ${rows.length} unvalidated species → ${shownName}`;
    return;
  }

  downloadBlob(filename, new Blob([csvText], { type: 'text/csv' }));
  if (statusEl) statusEl.textContent = `✓ ${rows.length} unvalidated species → ${filename}`;
}

// ── Local species search ──────────────────────────────────────────────────
// `regions`, if given, narrows to species recorded there — applied INSIDE the
// ranking loop, before the 8-result cap, not as a filter on top of it.
//
// Found 2026-07-26: a filter bolted on afterward (searchLocalSpecies(q).filter
// (_passesRegionFilter), formerly at both js/species.js call sites below and
// copied into the footage tag picker) silently broke broad common-name
// searches for a region whose matches happen to sit later in SPECIES_DB than
// 8 unrelated ones. "wrasse" is the case that surfaced it: 25 tropical wrasse
// species were added to the DB before the 6 UK ones, so a UK-filtered search
// filled its 8-slot cap entirely with tropical, region-filtered-out results —
// "Ballan Wrasse" never survived to be filtered because it never made the cap
// in the first place. A narrower query ("ballan") dodged the collision by
// having few enough raw matches that the UK one was still within the top 8.
// Region-aware ranking, not post-hoc filtering, is the only fix that scales:
// the cap has to apply to the results a region filter would actually want.
function searchLocalSpecies(q, regions) {
  const lq = q.toLowerCase();
  const results = [];
  const seen = new Set();
  const inRegion = s => !regions || speciesRowInRegions(s, regions);
  // Common name starts with query — highest priority
  for (const s of SPECIES_DB) {
    if (s[0].toLowerCase().startsWith(lq) && inRegion(s) && !seen.has(s[1])) {
      results.push({ commonName: s[0], scientificName: s[1], aphiaId: s[2], group: s[3], photoUrl: s[4] || '', iucnStatus: s[5] || '', source: 'local' });
      seen.add(s[1]);
    }
  }
  // Common name contains query
  for (const s of SPECIES_DB) {
    if (s[0].toLowerCase().includes(lq) && inRegion(s) && !seen.has(s[1])) {
      results.push({ commonName: s[0], scientificName: s[1], aphiaId: s[2], group: s[3], photoUrl: s[4] || '', iucnStatus: s[5] || '', source: 'local' });
      seen.add(s[1]);
    }
  }
  // Scientific name contains query
  for (const s of SPECIES_DB) {
    if (s[1].toLowerCase().includes(lq) && inRegion(s) && !seen.has(s[1])) {
      results.push({ commonName: s[0], scientificName: s[1], aphiaId: s[2], group: s[3], photoUrl: s[4] || '', iucnStatus: s[5] || '', source: 'local' });
      seen.add(s[1]);
    }
  }
  // Custom registry entries (previously-logged free-text species) — always
  // included regardless of region, same exemption region filtering uses
  // everywhere else: no aphiaId means no region data to filter on, and these
  // are the diver's own real logged history, not an unfamiliar reference list.
  for (const [customId, e] of Object.entries(customRegistry)) {
    if ((e.commonName || '').toLowerCase().includes(lq) && !seen.has(customId)) {
      results.push({ commonName: e.commonName, scientificName: e.scientificName || '',
                     aphiaId: null, group: e.group || '', photoUrl: '', iucnStatus: '',
                     customId, source: 'custom' });
      seen.add(customId);
    }
  }
  return results.slice(0, 8);
}

// ── Species cache ──────────────────────────────────────────────────────────
let speciesCache = JSON.parse(localStorage.getItem('divelog-species-cache') || '{}');
// cache: { "grey reef shark": { scientificName, commonName, aphiaId } }

function saveCache() {
  localStorage.setItem('divelog-species-cache', JSON.stringify(speciesCache));
}

// ── Species lookup ────────────────────────────────────────────────────────
let searchTimer = null;
let dropdownResults = [];
let focusedIndex = -1;

function setStatus(msg, cls) {
  const el = document.getElementById('species-status');
  el.innerHTML = msg;
  el.className = 'species-status ' + (cls || '');
}

// ── Form species panel ────────────────────────────────────────────────────────
// Anchored panel above the search input. Identical look to the footage modal
// species picker: single-column photo grid, category tabs at bottom.
// Typing narrows the grid in-place — no mode switch between browse and search.

let _formPanelGroup = 'Fish'; // active browse tab for the form panel

// Render one cell — 2-column desktop grid, same classes as footage modal desktop.
function _formCellHtml(r) {
  const sciAttr = r.scientificName.replace(/&/g,'&amp;').replace(/"/g,'&quot;');
  const comAttr = (r.commonName || '').replace(/&/g,'&amp;').replace(/"/g,'&quot;');
  const grpAttr = (r.group || '').replace(/"/g,'&quot;');
  const cusAttr = (r.customId || '');
  const comHtml = (r.commonName || r.scientificName)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const sciHtml = r.scientificName
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const photoUrl = r.photoUrl
    ? r.photoUrl.replace('/square.','/medium.').replace('square.','medium.')
    : '';
  const imgHtml = photoUrl
    ? `<img src="${photoUrl}" alt="" loading="lazy">`
    : `<div class="sp-cell-ph-grid">${GROUP_EMOJI[r.group] || '🐟'}</div>`;
  const iucnHtml = r.iucnStatus ? iucnBadge(r.iucnStatus) : '';
  return `<div class="sp-cell-2col"
    data-sci="${sciAttr}" data-common="${comAttr}"
    data-aphia="${r.aphiaId || ''}" data-group="${grpAttr}"
    data-custom="${cusAttr}"
    onmousedown="event.preventDefault();_pickFormCell(this)">
    ${imgHtml}
    <div class="sp-cell-info">
      <div class="sp-cell-name">${comHtml}</div>
      <div class="sp-cell-sci">${sciHtml}</div>
      ${iucnHtml ? `<div class="sp-cell-badge">${iucnHtml}</div>` : ''}
    </div>
  </div>`;
}

// Select a species from the form panel via its cell element's data-* attrs.
function _pickFormCell(el) {
  const sp = {
    scientificName: el.dataset.sci    || '',
    commonName:     el.dataset.common || '',
    aphiaId:        el.dataset.aphia  ? +el.dataset.aphia : null,
    group:          el.dataset.group  || '',
    validated:      !!el.dataset.aphia,
  };
  if (el.dataset.custom) sp.customId = el.dataset.custom;
  addSighting(sp);
  document.getElementById('marine-input').value = '';
  setStatus('');
  hideDropdown();
}

// Tab click from the form panel. Clears any search query and re-renders the group.
function _setFormPanelGroup(g) {
  _formPanelGroup = g;
  document.getElementById('marine-input').value = '';
  _renderFormPanel('');
}

// Search all species without the 8-result cap (used for grid view).
function _formSearchAll(q) {
  const lq = q.toLowerCase();
  const out = [], seen = new Set();
  for (const s of SPECIES_DB) {
    if (s[0].toLowerCase().startsWith(lq) && !seen.has(s[1])) {
      out.push({ commonName: s[0], scientificName: s[1], aphiaId: s[2], group: s[3], photoUrl: s[4] || '', iucnStatus: s[5] || '' });
      seen.add(s[1]);
    }
  }
  for (const s of SPECIES_DB) {
    if (s[0].toLowerCase().includes(lq) && !seen.has(s[1])) {
      out.push({ commonName: s[0], scientificName: s[1], aphiaId: s[2], group: s[3], photoUrl: s[4] || '', iucnStatus: s[5] || '' });
      seen.add(s[1]);
    }
  }
  for (const s of SPECIES_DB) {
    if (s[1].toLowerCase().includes(lq) && !seen.has(s[1])) {
      out.push({ commonName: s[0], scientificName: s[1], aphiaId: s[2], group: s[3], photoUrl: s[4] || '', iucnStatus: s[5] || '' });
      seen.add(s[1]);
    }
  }
  // Custom registry entries (previously-logged free-text species)
  for (const [customId, e] of Object.entries(customRegistry)) {
    if ((e.commonName || '').toLowerCase().includes(lq) && !seen.has(customId)) {
      out.push({ commonName: e.commonName, scientificName: e.scientificName || '',
                 aphiaId: null, group: e.group || '', photoUrl: '', iucnStatus: '',
                 customId, source: 'custom' });
      seen.add(customId);
    }
  }
  return out.filter(_passesRegionFilter);
}

// Render or update the form species panel. q drives browse (q='') vs search (q≥2).
function _renderFormPanel(q) {
  const dd = document.getElementById('species-dropdown');
  if (!dd) return;
  const isSearch = q.length >= 2;

  let visible;
  if (isSearch) {
    visible = _formSearchAll(q);
  } else {
    visible = SPECIES_DB
      .filter(s => s[3] === _formPanelGroup && _rowPassesRegionFilter(s))
      .map(s => ({ commonName: s[0], scientificName: s[1], aphiaId: s[2], group: s[3], photoUrl: s[4] || '', iucnStatus: s[5] || '' }))
      .sort((a, b) => a.commonName.localeCompare(b.commonName));
  }

  const cellsHtml = visible.map(_formCellHtml).join('');

  const tabsHtml = BROWSE_GROUPS.map(g =>
    `<div class="species-browse-tab${g === _formPanelGroup ? ' active' : ''}" role="tab" aria-selected="${g === _formPanelGroup}" tabindex="0"
      onmousedown="event.preventDefault();_setFormPanelGroup('${g}')"
      onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();_setFormPanelGroup('${g}')}">
      ${GROUP_EMOJI[g]} ${g} <span class="tab-count">${_groupCountFor(g)}</span>
    </div>`
  ).join('');

  // If panel already open, update grid + tabs in-place (smooth, no flash)
  const existingScroll = dd.querySelector('.sp-browse-scroll');
  if (existingScroll && dd.style.display !== 'none') {
    const grid = existingScroll.querySelector('.sp-grid-2col');
    if (grid) grid.innerHTML = cellsHtml || '<div class="sp-grid-empty">No results</div>';
    existingScroll.scrollTop = 0;
    const tabs = dd.querySelector('.species-browse-tabs');
    if (tabs) { tabs.innerHTML = tabsHtml; tabs.classList.toggle('sp-tabs-hidden', isSearch); }
    return;
  }

  // First open — build full structure
  dd.innerHTML = `
    <div class="sp-browse-scroll">
      <div class="sp-grid-2col">${cellsHtml || '<div class="sp-grid-empty">No results</div>'}</div>
    </div>
    <div class="species-browse-tabs${isSearch ? ' sp-tabs-hidden' : ''}" role="tablist">
      ${tabsHtml}
    </div>`;
  dd.classList.add('browse-mode');
  dd.style.display = 'flex';
}

function onSpeciesInput() {
  // Mobile: open the full-screen overlay instead of the anchored panel
  if (window.innerWidth <= 600) {
    const siteCtx = document.getElementById('f-site')?.value || '';
    showMobileSpeciesPicker(sp => {
      addSighting({ ...sp });
      const inp = document.getElementById('marine-input');
      if (inp) inp.value = '';
    }, 'LOG DIVE', siteCtx);
    return;
  }
  clearTimeout(searchTimer);
  // Desktop: ensure the species photo grid is hosted in the right rail before rendering
  if (typeof lfEnsureMarineRail === 'function') lfEnsureMarineRail();
  const q = document.getElementById('marine-input').value.trim();
  _renderFormPanel(q);
  // Status line: hint when search returns nothing
  if (q.length >= 2 && _formSearchAll(q).length === 0) {
    setStatus('Not in local database — use free text or check spelling.', 'status-noresult');
  } else {
    setStatus('');
  }
}

const GROUP_EMOJI = {
  'Shark': '🦈', 'Ray': '🐟', 'Fish': '🐠', 'Eel': '🐍',
  'Cephalopod': '🐙', 'Crustacean': '🦐', 'Echinoderm': '⭐',
  'Mollusc': '🐚', 'Coral': '🪸', 'Sponge': '🧽',
  'Jellyfish': '🪼', 'Reptile': '🐢', 'Mammal': '🐬',
  'Worm': '🪱', 'Tunicate': '🫧'
};

const IUCN_LABELS = { CR: 'CR', EN: 'EN', VU: 'VU', NT: 'NT', LC: 'LC', DD: 'DD', EX: 'EX', EW: 'EW' };
function iucnBadge(status) {
  if (!status || !IUCN_LABELS[status]) return '';
  return `<span class="iucn-badge iucn-${status}">${status}</span>`;
}

// Built once — scientificName → photo URL / IUCN status / region-tags lookups
const SP_PHOTO_MAP   = Object.fromEntries(SPECIES_DB.filter(s => s[4]).map(s => [s[1], s[4]]));
const SP_IUCN_MAP    = Object.fromEntries(SPECIES_DB.filter(s => s[5]).map(s => [s[1], s[5]]));
const SP_REGIONS_MAP = Object.fromEntries(SPECIES_DB.filter(s => s[6]).map(s => [s[1], s[6]]));

// ── Log-form Country pre-filter (ROADMAP.md → "Species Distribution Data") ──
// Maps the log form's Country <select> (index.html #f-location) to the 8
// region codes SPECIES_DB's 7th field uses (scripts/fetch-species-regions.py).
// Deliberately coarser/broader than the small representative-country lists
// that BUILT those region tags — a country not used to define a region can
// still genuinely sit in its waters (e.g. Cambodia wasn't queried to build
// 'sea', but a diver logging there should see the same species tagged for
// neighbouring Thailand). SEA countries also carry 'ip' (broad Indo-Pacific)
// since that bucket's own representative area is a real, overlapping subset
// of the same fauna, not a distinct one.
//
// Countries genuinely spanning two of this app's regions (Mexico, Costa
// Rica, Panama, Colombia — Caribbean AND Pacific coastlines) carry both.
// Conservatively left OUT entirely (filter simply never triggers) rather
// than guessed: anywhere with no established dive-tourism/OBIS-region fit
// (most of West/Central Africa, mainland Middle East beyond the Red Sea,
// landlocked countries), and large countries whose coastline spans several
// of these regions with no single good answer (United States: Pacific,
// Gulf, Atlantic/Caribbean-adjacent Florida, and Indo-Pacific Hawaii all at
// once — a single country selection can't disambiguate which; same
// reasoning excludes South Africa, Japan, Brazil). A missing entry is
// always the safe failure mode here — an absent filter never hides a real
// species, a wrong one silently would.
const COUNTRY_REGIONS = {
  // Southeast Asia (+ overlapping broad Indo-Pacific)
  'Indonesia': ['sea', 'ip'], 'Philippines': ['sea', 'ip'], 'Thailand': ['sea', 'ip'],
  'Malaysia': ['sea', 'ip'], 'Vietnam': ['sea', 'ip'], 'Singapore': ['sea', 'ip'],
  'Brunei': ['sea', 'ip'], 'Cambodia': ['sea', 'ip'], 'Myanmar': ['sea', 'ip'],
  'Timor-Leste': ['sea', 'ip'],
  // Broader Indo-Pacific — Indian Ocean islands/coast + Pacific islands
  'Maldives': ['ip'], 'Sri Lanka': ['ip'], 'India': ['ip'], 'Madagascar': ['ip'],
  'Mauritius': ['ip'], 'Seychelles': ['ip'], 'Comoros': ['ip'], 'Mozambique': ['ip'],
  'Tanzania': ['ip'], 'Kenya': ['ip'], 'Papua New Guinea': ['ip'], 'Fiji': ['ip'],
  'Palau': ['ip'], 'Micronesia': ['ip'], 'Solomon Islands': ['ip'], 'Vanuatu': ['ip'],
  'Kiribati': ['ip'], 'Marshall Islands': ['ip'], 'Nauru': ['ip'], 'Samoa': ['ip'],
  'Tonga': ['ip'], 'Tuvalu': ['ip'],
  // Red Sea
  'Egypt': ['rs'], 'Saudi Arabia': ['rs'], 'Sudan': ['rs'], 'Djibouti': ['rs'],
  'Jordan': ['rs'], 'Eritrea': ['rs'], 'Yemen': ['rs'], 'Israel': ['rs', 'med'],
  // Mediterranean (+ Atlantic overlap for countries with both coasts)
  'Italy': ['med'], 'Greece': ['med'], 'Spain': ['med'], 'Croatia': ['med'],
  'Malta': ['med'], 'Cyprus': ['med'], 'Turkey': ['med'], 'Tunisia': ['med'],
  'Libya': ['med'], 'Monaco': ['med'], 'Albania': ['med'],
  'France': ['med', 'na'], 'Morocco': ['med', 'na'],
  // NE Atlantic / UK-European waters
  'United Kingdom': ['na'], 'Ireland': ['na'], 'Norway': ['na'], 'Portugal': ['na'],
  'Netherlands': ['na'], 'Denmark': ['na'],
  // Caribbean
  'Bahamas': ['car'], 'Belize': ['car'], 'Cuba': ['car'], 'Jamaica': ['car'],
  'Dominican Republic': ['car'], 'Honduras': ['car'], 'Trinidad and Tobago': ['car'],
  'Saint Lucia': ['car'], 'Saint Kitts and Nevis': ['car'],
  'Saint Vincent and the Grenadines': ['car'], 'Grenada': ['car'], 'Dominica': ['car'],
  'Barbados': ['car'], 'Antigua and Barbuda': ['car'], 'Haiti': ['car'],
  'Guyana': ['car'], 'Suriname': ['car'], 'Venezuela': ['car'],
  // Eastern Pacific (+ Caribbean overlap for isthmus/two-coast countries)
  'Ecuador': ['ep'], 'Peru': ['ep'], 'Chile': ['ep'], 'El Salvador': ['ep'],
  'Mexico': ['car', 'ep'], 'Costa Rica': ['car', 'ep'], 'Panama': ['car', 'ep'],
  'Colombia': ['car', 'ep'], 'Nicaragua': ['car', 'ep'], 'Guatemala': ['car', 'ep'],
  // Australia/GBR
  'Australia': ['au'],
};

// Filter currently applied to species search/browse on the log form (mobile +
// desktop pickers), or null when off. Session-scoped only (in-memory, resets
// on reload) — "Show all" clears it until the Country field is changed again.
let _speciesRegionFilter = null;

// ── Region primitives ──────────────────────────────────────────────────────
// Take the regions array explicitly rather than reading _speciesRegionFilter,
// so a second surface can narrow by region against its OWN state. The footage
// tag picker (js/footage.js) does exactly that — it filters on the dive's own
// country, and must not share one mutable filter with the log form: they can
// be open for different countries, and whichever wrote last would silently
// re-scope the other. A null/absent regions list means "no filter".
function speciesRegionsForCountry(country) {
  return COUNTRY_REGIONS[country] || null;
}
function speciesRowInRegions(s, regions) {   // s = raw SPECIES_DB tuple
  if (!regions) return true;
  const tags = (s[6] || '').split('|');
  return regions.some(reg => tags.includes(reg));
}
function speciesNameInRegions(sciName, regions) {
  if (!regions) return true;
  const tags = (SP_REGIONS_MAP[sciName] || '').split('|');
  return regions.some(reg => tags.includes(reg));
}

// Free-text/custom entries have no region data at all (no aphiaId to have
// been tagged) and are the diver's own real logged history — always shown,
// never hidden by a filter meant to narrow an unfamiliar reference list.
function _passesRegionFilter(r) {
  if (r.source === 'custom') return true;
  return speciesNameInRegions(r.scientificName, _speciesRegionFilter && _speciesRegionFilter.regions);
}
function _rowPassesRegionFilter(s) {
  return speciesRowInRegions(s, _speciesRegionFilter && _speciesRegionFilter.regions);
}
// Category-tab count badge for group g — the precomputed global _groupCounts
// when no filter is active, otherwise a live recount against the active
// regions. Found live-testing: leaving badges on the unfiltered total while
// the grid itself was correctly narrowed read as "Fish 639" while a UK diver
// actually only ever saw ~90 — the badge has to track what tapping it does.
function _groupCountFor(g) {
  if (!_speciesRegionFilter) return _groupCounts[g] || 0;
  return SPECIES_DB.reduce((n, s) => n + (s[3] === g && _rowPassesRegionFilter(s) ? 1 : 0), 0);
}

// Called from lfCountryChange() (js/logform.js) whenever the log form's
// Country field changes. A country with no COUNTRY_REGIONS entry clears any
// active filter rather than leaving a stale one from a previous selection.
function updateSpeciesRegionFilter(country) {
  const regions = COUNTRY_REGIONS[country];
  _speciesRegionFilter = regions ? { country, regions } : null;
  _renderSpeciesFilterBanners();
}

function clearSpeciesRegionFilter() {
  _speciesRegionFilter = null;
  _renderSpeciesFilterBanners();
  const dd = document.getElementById('species-dropdown');
  if (dd && dd.style.display !== 'none') {
    _renderFormPanel((document.getElementById('marine-input')?.value || '').trim());
  }
  const ov = document.getElementById('sp-mob-overlay');
  if (ov && ov.style.display !== 'none') {
    // Full rebuild, not onMobSpInput()'s grid-only patch — that never touches
    // .fmp-tabs, so the category badges (now filter-aware, see _groupCountFor)
    // would keep showing the old filtered numbers until the next tab switch.
    const q = document.getElementById('smo-search')?.value || '';
    _mspDisconnectObs();
    ov.innerHTML = _mspOverlayHtml(q);
    _renderSpeciesFilterBanners();
    document.getElementById('smo-search')?.focus();
    if (_mspFullList.length > _mspBatch) _mspWatchSentinel();
  }
}

// Full-sentence form — the static mount in the Marine life section
// (index.html, visible before either picker opens; the only surface with
// room to spare for it).
function _speciesFilterBannerInnerHtml() {
  if (!_speciesRegionFilter) return '';
  const c = _speciesRegionFilter.country.replace(/&/g,'&amp;').replace(/</g,'&lt;');
  return `<span class="sp-region-banner-text">Showing species recorded near ${c}</span>
    <button type="button" class="sp-region-banner-btn" onmousedown="event.preventDefault();clearSpeciesRegionFilter()">Show all</button>`;
}
// Compact stacked form — the mobile picker's topbar left zone
// (_mspOverlayHtml), which shares the row with the search input and close
// button and has no room for a full sentence. Bare country name + Show all
// underneath, not "Showing species recorded near…". (A version of this
// pinned the search input to a fixed width and put the country zone on the
// right instead, so its own width could flex without disturbing the search
// box's — reverted: it needed the close button moved to the LEFT of the
// search box to read correctly, which broke the app's own top-right close-
// button convention everywhere else, and the resulting dead space next to
// a short country name looked worse than the search box itself resizing.)
function _speciesFilterCompactHtml() {
  if (!_speciesRegionFilter) return '';
  const c = _speciesRegionFilter.country.replace(/&/g,'&amp;').replace(/</g,'&lt;');
  return `<span class="fmp-topbar-region-name">${c}</span>
    <button type="button" class="sp-region-banner-btn" onmousedown="event.preventDefault();clearSpeciesRegionFilter()">Show all</button>`;
}
function _renderSpeciesFilterBanners() {
  document.querySelectorAll('.sp-region-banner-mount').forEach(el => {
    el.innerHTML = _speciesFilterBannerInnerHtml();
    el.classList.toggle('is-active', !!_speciesRegionFilter);
  });
  document.querySelectorAll('.fmp-topbar-region-mount').forEach(el => {
    el.innerHTML = _speciesFilterCompactHtml();
    el.classList.toggle('is-active', !!_speciesRegionFilter);
  });
}

// ── Species browse mode ──────────────────────────────────────────────────────
// Tab order: most dive-relevant groups first
const BROWSE_GROUPS = [
  // Vertebrates & vertebrate-adjacent
  'Mammal','Shark','Ray','Fish','Eel','Reptile',
  // Mobile invertebrates
  'Cephalopod','Crustacean','Jellyfish',
  // Reef-attached
  'Echinoderm','Mollusc','Coral','Sponge','Worm','Tunicate'
];
// Pre-compute count per group for tab chips
const _groupCounts = {};
for (const s of SPECIES_DB) _groupCounts[s[3]] = (_groupCounts[s[3]] || 0) + 1;

let _browseGroup = 'Fish';
let _browseCtx   = null;   // { ddId, onSelect }
let _browseList  = [];     // species in the active tab

function _renderBrowseGroup() {
  if (!_browseCtx) return;
  const dd = document.getElementById(_browseCtx.ddId);
  if (!dd) return;

  _browseList = SPECIES_DB
    .filter(s => s[3] === _browseGroup)
    .map(s => ({ commonName: s[0], scientificName: s[1], aphiaId: s[2], group: s[3], photoUrl: s[4] || '', iucnStatus: s[5] || '' }))
    .sort((a, b) => a.commonName.localeCompare(b.commonName));

  const tabs = BROWSE_GROUPS.map(g =>
    `<div class="species-browse-tab${g === _browseGroup ? ' active' : ''}" role="tab" aria-selected="${g === _browseGroup}" tabindex="0"
      onmousedown="event.preventDefault();_setBrowseGroup('${g}')"
      onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();_setBrowseGroup('${g}')}">
      ${GROUP_EMOJI[g]} ${g} <span class="tab-count">${_groupCounts[g] || 0}</span>
    </div>`
  ).join('');

  if (_browseCtx.ddId === 'species-dropdown') {
    // ── Form dropdown: 2-col photo grid (scrollable) + tabs pinned at bottom ──
    const cells = _browseList.map((r, i) => {
      const thumb = r.photoUrl
        ? `<img class="sp-browse-thumb-sm" src="${r.photoUrl.replace('/square.', '/small.').replace('square.', 'small.')}" alt="" loading="lazy">`
        : `<div class="sp-browse-ph-sm">${GROUP_EMOJI[r.group] || '🐟'}</div>`;
      return `<div class="sp-browse-cell" onmousedown="event.preventDefault();_pickBrowsed(${i})">
        ${thumb}
        <div class="sp-browse-info">
          <div class="sp-browse-name-sm">${esc(r.commonName)}${iucnBadge(r.iucnStatus)}</div>
          <div class="sp-browse-sci-sm"><em>${esc(r.scientificName)}</em></div>
        </div>
      </div>`;
    }).join('');
    dd.innerHTML = `<div class="sp-browse-scroll">${cells}</div><div class="species-browse-tabs" role="tablist">${tabs}</div>`;
    dd.classList.add('browse-mode');
    dd.style.display = 'flex';
  } else {
    // ── Modal dropdown: original single-column list, tabs at top ──
    const items = _browseList.map((r, i) => {
      const thumb = r.photoUrl
        ? `<img class="species-thumb" src="${r.photoUrl.replace('/square.', '/small.').replace('square.', 'small.')}" alt="" loading="lazy">`
        : `<div class="species-thumb-placeholder">${GROUP_EMOJI[r.group] || '🐟'}</div>`;
      return `<div class="species-option" onmousedown="event.preventDefault();_pickBrowsed(${i})">
        ${thumb}
        <div class="species-option-text">
          <div class="species-name">${esc(r.commonName)}${iucnBadge(r.iucnStatus)}</div>
          <div class="species-common"><em>${esc(r.scientificName)}</em></div>
        </div>
      </div>`;
    }).join('');
    dd.innerHTML = `<div class="species-browse-tabs" role="tablist">${tabs}</div>${items}`;
    dd.classList.add('browse-mode');
    dd.style.display = 'block';
  }
}

function _setBrowseGroup(group) {
  _browseGroup = group;
  _renderBrowseGroup();
  dismissKeyboardOnMobile(); // tapping a category tab must not re-pop the keyboard
}

function _pickBrowsed(i) {
  const sp = _browseList[i];
  if (sp && _browseCtx) _browseCtx.onSelect(sp);
  dismissKeyboardOnMobile(); // picking from the browse menu also drops the keyboard
}

function showBrowseMode(ddId, onSelect) {
  _browseCtx = { ddId, onSelect };
  _renderBrowseGroup();
  // NOTE: do NOT dismiss the keyboard here — showBrowseMode is triggered by
  // the input's onfocus, so blurring here would make typing-to-search
  // impossible on mobile (every tap to type would instantly blur). The
  // keyboard is dismissed only on explicit browse actions below.
}

// onSelect handler for the log-form browse context
function _browseSelectForm(sp) {
  addSighting({ scientificName: sp.scientificName, commonName: sp.commonName,
    aphiaId: sp.aphiaId || null, group: sp.group, validated: true });
  document.getElementById('marine-input').value = '';
  setStatus('');
  hideDropdown();
}

function showDropdown(results) {
  dropdownResults = results;
  focusedIndex = -1;
  const dd = document.getElementById('species-dropdown');
  if (!results.length) { dd.style.display = 'none'; return; }
  dd.innerHTML = results.map((r, i) => {
    const badgeMap = { local: ['badge-worms', 'Validated'], cache: ['badge-cache', 'cached'], worms: ['badge-worms', 'Validated'] };
    const [badgeCls, badgeLabel] = badgeMap[r.source] || ['badge-free', 'unverified'];
    const primaryLine   = esc(r.commonName) || `<em>${esc(r.scientificName)}</em>`;
    const secondaryLine = r.commonName  ? `<em>${esc(r.scientificName)}</em>` : '';
    const groupTag      = r.group ? ` <span class="mono-dim-sm">${esc(r.group)}</span>` : '';
    const thumb = r.photoUrl
      ? `<img class="species-thumb" src="${r.photoUrl.replace('/square.', '/small.').replace('square.', 'small.')}" alt="" loading="lazy">`
      : `<div class="species-thumb-placeholder">${GROUP_EMOJI[r.group] || '🐟'}</div>`;
    return `
    <div class="species-option" data-i="${i}" onmousedown="selectSpecies(${i})">
      ${thumb}
      <div class="species-option-text">
        <div class="species-name">
          ${primaryLine}
          <span class="species-badge ${badgeCls}">${badgeLabel}</span>${groupTag}${iucnBadge(r.iucnStatus)}
        </div>
        ${secondaryLine ? `<div class="species-common">${secondaryLine}</div>` : ''}
      </div>
    </div>`;
  }).join('');
  dd.style.display = 'block';
}

function hideDropdown() {
  const dd = document.getElementById('species-dropdown');
  dd.style.display = 'none';
  dd.classList.remove('browse-mode');
  dropdownResults = [];
  focusedIndex = -1;
  // Only clear _browseCtx when it belongs to the form dropdown — another
  // context (e.g. footage search) may be mid-use of its own.
  if (_browseCtx?.ddId === 'species-dropdown') _browseCtx = null;
}

function onSpeciesKeydown(e) {
  // Form panel is a grid — no arrow-key navigation between cells.
  // Enter adds whatever is typed as free text; Escape closes the panel.
  if (e.key === 'Enter') { e.preventDefault(); addFreeText(); }
  else if (e.key === 'Escape') { hideDropdown(); }
}

function updateFocus() {
  document.querySelectorAll('.species-option').forEach((el, i) => {
    el.classList.toggle('focused', i === focusedIndex);
  });
}

function selectSpecies(i) {
  const r = dropdownResults[i];
  if (!r) return;
  addSighting({
    scientificName: r.scientificName,
    commonName: r.commonName,
    aphiaId: r.aphiaId || null,
    group: r.group || '',
    validated: r.source === 'local' || r.source === 'cache'
  });
  document.getElementById('marine-input').value = '';
  setStatus('');
  hideDropdown();
  dismissKeyboardOnMobile();
}

function addFreeText() {
  const val = document.getElementById('marine-input').value.trim();
  if (!val) return;
  const customId = resolveCustomId(val);
  addSighting({ scientificName: val, commonName: val, aphiaId: null, group: '', validated: false, customId });
  document.getElementById('marine-input').value = '';
  setStatus('');
  hideDropdown();
  dismissKeyboardOnMobile();
}

// Mobile only: drop the on-screen keyboard so it stops covering the
// species dropdown / category tabs / Save button. Desktop keeps focus
// (fast consecutive entry; keyboard isn't a concern there). Blurs the
// active input so it works for both the form and the modal search.
// The dropdown is NOT focus-tied (closed only by outside-click), so
// blurring while browsing keeps the category menu open and tappable.
function dismissKeyboardOnMobile() {
  if (!window.matchMedia('(max-width: 600px)').matches) return;
  const a = document.activeElement;
  if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA')) a.blur();
}

// Close dropdown when clicking outside
document.addEventListener('click', e => {
  const wrap = document.getElementById('species-search-wrap');
  const dd   = document.getElementById('species-dropdown');
  // On desktop the dropdown is moved into the rail (outside species-search-wrap),
  // so also guard against clicks inside the dropdown itself.
  if (!wrap.contains(e.target) && !dd?.contains(e.target)) hideDropdown();
});

// ── Sightings ───────────────────────────────────────────────────────────────
function addSighting(species) {
  // Don't duplicate — match on customId first (stable), then scientificName
  const existing = sightings.find(s =>
    (species.customId && s.customId === species.customId) ||
    s.scientificName.toLowerCase() === species.scientificName.toLowerCase()
  );
  if (existing) { renderSightings(); return; }
  sightings.push({ ...species });
  renderSightings();
}

function removeSighting(i) {
  sightings.splice(i, 1);
  renderSightings();
}

// Seasearch R/O/C: R = 1–2, O = 3–9, C = 10+
function countToAbundance(count) {
  const n = parseInt(count) || 0;
  if (n <= 0)  return '';
  if (n <= 2)  return 'R';
  if (n <= 9)  return 'O';
  return 'C';
}

// Derive abundance from count where missing — safe to call multiple times after any sync
function migrateAbundance() {
  let changed = false;
  dives.forEach(d => {
    (d.marine || []).forEach(m => {
      if (!m.abundance && m.count) {
        m.abundance = countToAbundance(m.count);
        changed = true;
      }
    });
  });
  if (changed) localStorage.setItem('divelog-dives', JSON.stringify(dives));
}

function renderSightings() {
  const el = document.getElementById('sighting-list');
  // Update the Marine section summary chip (if the section is collapsed)
  if (typeof _updateSectionSummary === 'function') _updateSectionSummary('cs-marine');
  if (!sightings.length) { el.innerHTML = ''; return; }
  el.innerHTML = sightings.map((s, i) => {
    const roc = s.abundance || '';
    return `
    <div class="sighting-card">
      <div class="sighting-name">
        <div class="sighting-scientific">${esc(s.scientificName)}
          <span class="species-badge ${s.validated ? 'badge-worms' : 'badge-free'}">${s.validated ? 'Validated' : 'unvalidated'}</span>
        </div>
        ${s.commonName ? `<div class="sighting-common">${esc(s.commonName)}</div>` : ''}
      </div>
      <div class="roc-group">
        <div class="roc-btn-row" role="group" aria-label="Abundance">
          <button class="roc-btn${roc==='R'?' active':''}" aria-pressed="${roc==='R'}" aria-label="Rare" onclick="setAbundance(${i},'R')">R</button>
          <button class="roc-btn${roc==='O'?' active':''}" aria-pressed="${roc==='O'}" aria-label="Occasional" onclick="setAbundance(${i},'O')">O</button>
          <button class="roc-btn${roc==='C'?' active':''}" aria-pressed="${roc==='C'}" aria-label="Common" onclick="setAbundance(${i},'C')">C</button>
        </div>
      </div>
      <button class="sighting-remove" onclick="removeSighting(${i})" aria-label="Remove ${esc(s.scientificName)}">×</button>
    </div>`;
  }).join('');
}

function setAbundance(i, val) {
  sightings[i].abundance = sightings[i].abundance === val ? '' : val; // tap again to deselect
  renderSightings();
}

// ── Generic mobile species picker overlay ─────────────────────────────────────
// Full-screen fixed overlay used by the log-dive form (including edit mode) on
// narrow screens (≤600px). Reuses .fmp-* CSS classes and .sp-cell-1col/
// .sp-grid-1col from the footage overlay. Separate state from the footage picker.

let _mspGroup    = 'Fish';   // active browse tab
let _mspOnSelect = null;     // callback: function(species) — called on pick or free text
let _mspTag      = '';       // accent footer label e.g. "LOG DIVE"
let _mspCtx      = '';       // muted footer context e.g. "Batu Balong"
let _mspFullList = [];       // full browse-tab list for batched rendering
let _mspBatch    = 60;       // items currently rendered
let _mspObs      = null;     // IntersectionObserver for infinite scroll

function _mspDisconnectObs() {
  if (_mspObs) { _mspObs.disconnect(); _mspObs = null; }
}

// Single-column photo cell — same data-* API as footage's _pickerCell1ColHtml
function _mspCellHtml(r) {
  const sciAttr = r.scientificName.replace(/&/g,'&amp;').replace(/"/g,'&quot;');
  const comAttr = (r.commonName || '').replace(/&/g,'&amp;').replace(/"/g,'&quot;');
  const grpAttr = (r.group || '').replace(/"/g,'&quot;');
  const cusAttr = (r.customId || '');
  const comHtml = (r.commonName || r.scientificName)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const sciHtml = r.scientificName
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const photoUrl = r.photoUrl
    ? r.photoUrl.replace('/square.','/medium.').replace('square.','medium.')
    : '';
  const imgHtml = photoUrl
    ? `<img src="${photoUrl}" alt="" loading="lazy">`
    : `<div class="sp-cell-ph-mob">${GROUP_EMOJI[r.group] || '🐟'}</div>`;
  const iucnHtml = r.iucnStatus ? iucnBadge(r.iucnStatus) : '';
  return `<div class="sp-cell-1col"
    data-sci="${sciAttr}" data-common="${comAttr}"
    data-aphia="${r.aphiaId || ''}" data-group="${grpAttr}"
    data-custom="${cusAttr}"
    onmousedown="event.preventDefault();_mspPickSpecies(this)">
    ${imgHtml}
    <div class="sp-cell-info">
      <div class="sp-cell-name">${comHtml}</div>
      <div class="sp-cell-sci">${sciHtml}</div>
      ${iucnHtml ? `<div class="sp-cell-badge">${iucnHtml}</div>` : ''}
    </div>
  </div>`;
}

// Builds the inner HTML of the overlay. Resets _mspBatch and _mspFullList.
function _mspOverlayHtml(q) {
  _mspBatch    = 60;
  _mspFullList = [];

  const isSearch = q.length >= 2;
  let visible;

  if (isSearch) {
    visible = searchLocalSpecies(q, _speciesRegionFilter && _speciesRegionFilter.regions);
  } else {
    _mspFullList = SPECIES_DB
      .filter(s => s[3] === _mspGroup && _rowPassesRegionFilter(s))
      .map(s => ({ commonName: s[0], scientificName: s[1], aphiaId: s[2],
                   group: s[3], photoUrl: s[4] || '', iucnStatus: s[5] || '' }))
      .sort((a, b) => a.commonName.localeCompare(b.commonName));
    visible = _mspFullList.slice(0, _mspBatch);
  }

  const hasMore   = _mspFullList.length > _mspBatch;
  const cellsHtml = visible.map(_mspCellHtml).join('');
  const sentinel  = hasMore ? '<div id="smo-sentinel" class="sp-load-sentinel"></div>' : '';

  const tabsHtml = BROWSE_GROUPS.map(g =>
    `<div class="sp-picker-tab${g === _mspGroup ? ' active' : ''}" role="tab" aria-selected="${g === _mspGroup}" tabindex="0"
          onmousedown="event.preventDefault();setMobSpTab('${g}')"
          onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();setMobSpTab('${g}')}">
       ${GROUP_EMOJI[g] || ''} ${g}
       <span class="tab-count">${_groupCountFor(g)}</span>
     </div>`
  ).join('');

  const tagEsc = _mspTag.replace(/&/g,'&amp;').replace(/"/g,'&quot;');
  const qAttr  = q.replace(/</g,'&lt;').replace(/"/g,'&quot;');
  const placeholderEsc = (_mspCtx ? ('Search species for ' + _mspCtx + '…') : 'Search species…')
    .replace(/&/g,'&amp;').replace(/"/g,'&quot;');

  // Topbar merges what used to be two stacked rows — tag+search+close, then
  // a separate full-sentence region banner below it — into one, freeing a
  // whole row back for results once the keyboard is up (reported directly
  // as wasteful screen space). The visible "LOG DIVE" tag is gone too — the
  // space it used to sit in is now the Country pre-filter's compact name +
  // Show all (_speciesFilterCompactHtml); the tag moves to an aria-label
  // instead of disappearing outright (there's only ever one flow through
  // this picker today, but a screen reader user still gets the context).
  // Region zone FIRST, search + close LAST, close staying at the far right
  // — matches the close-button position on every other full-screen surface
  // in the app. A version tried close+search first and let the region zone
  // flex on the right instead (so search could stay a fixed width); reverted
  // — it broke that convention, and the leftover white space next to a
  // short country name looked worse than the search box itself changing
  // size does. The search input DOES flex with however much room the
  // region zone's max-width leaves it (see the CSS comment on
  // .fmp-topbar-region-mount) — a short name means a wider search box, and
  // that's the accepted trade-off.
  return `
    <div class="fmp-topbar">
      <div class="fmp-topbar-region-mount"></div>
      <input id="smo-search" type="text" class="fmp-search-input"
             value="${qAttr}" placeholder="${placeholderEsc}"
             aria-label="${tagEsc} species search"
             autocomplete="off" oninput="onMobSpInput()">
      <button class="fmp-close" onclick="closeMobileSpeciesPicker()">✕</button>
    </div>
    <div class="fmp-tabs${isSearch ? ' fmp-tabs--hidden' : ''}" role="tablist">
      ${tabsHtml}
    </div>
    <div class="fmp-results">
      <div class="sp-grid-1col">
        ${cellsHtml || _mspEmptyStateHtml(q, isSearch)}
        ${sentinel}
      </div>
    </div>`;
}

// Zero-match state IS the free-text affordance now — no separate floating
// button that a mobile user could tap with no text in the field to act on
// (the old base "+ Free text" button read from #marine-input, which mobile's
// oninput/onfocus always redirect away from before it can hold typed text).
function _mspEmptyStateHtml(q, isSearch) {
  if (!isSearch) return '<div class="sp-grid-empty">No results</div>';
  const qEsc = q.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  return `<div class="sp-cell-1col sp-cell-addfree" onmousedown="event.preventDefault();_mspAddFreeText()">
    <div class="sp-addfree-ic">+</div>
    <div class="sp-cell-info">
      <div class="sp-cell-name">Add "${qEsc}" as a new sighting</div>
      <div class="sp-cell-sci">Not in the species database — tap to log it as free text</div>
    </div>
  </div>`;
}

// Single source of truth for tab visibility — tabs hide only once there's an
// active 2+ character query (search results replace category browsing at
// that point); focus alone no longer hides them, since they sit above the
// keyboard now, not competing with it. Called from onMobSpInput on every
// keystroke.
function _mspSyncTabsVisibility() {
  const input = document.getElementById('smo-search');
  const tabs  = document.querySelector('#sp-mob-overlay .fmp-tabs');
  if (!input || !tabs) return;
  const isSearch = input.value.trim().length >= 2;
  tabs.classList.toggle('fmp-tabs--hidden', isSearch);
}

// Create (once) and show the overlay. `onSelect(species)` is called on pick.
function showMobileSpeciesPicker(onSelect, tag, ctx) {
  _mspOnSelect = onSelect;
  _mspTag      = tag || '';
  _mspCtx      = ctx || '';
  let ov = document.getElementById('sp-mob-overlay');
  if (!ov) {
    ov = document.createElement('div');
    ov.id = 'sp-mob-overlay';
    document.body.appendChild(ov);
  }
  _mspDisconnectObs();
  ov.innerHTML = _mspOverlayHtml('');
  _renderSpeciesFilterBanners();
  ov.style.display = 'flex';
  // This overlay never locked body scroll (unlike every other full-screen
  // overlay in the app — speciesProfile, footage). With the page behind it
  // still scrollable, focusing the search input could let the keyboard-open
  // event drag the underlying document's scroll position, visually pushing
  // this fixed-position overlay's own topbar off-screen — reported directly:
  // worked once the keyboard was already open and settled, broke on the
  // first focus of a session. Locking scroll removes the page's own scroll
  // position as something a focus/resize event could act on.
  if (typeof _lockScroll === 'function') _lockScroll();
  // Auto-focus (re-added, reversing the earlier v2.91 decision not to) — the
  // sole mobile entry point is now a button literally labelled "Search
  // species…", so opening it already signals search intent; requiring a
  // second tap just to reach the keyboard was reported directly as annoying.
  // The "just browsing" case is still served — category tabs sit right under
  // the search bar (see _mspOverlayHtml) and stay visible above the keyboard
  // rather than needing it dismissed first. This runs inside the same click
  // handler that opened the overlay, so it's still a live user gesture — the
  // keyboard is allowed to open on both Android Chrome and iOS Safari.
  document.getElementById('smo-search')?.focus();
  if (_mspFullList.length > _mspBatch) _mspWatchSentinel();
}

// Hide the overlay and tear down state.
function closeMobileSpeciesPicker() {
  const ov = document.getElementById('sp-mob-overlay');
  if (ov) ov.style.display = 'none';
  _mspDisconnectObs();
  _mspOnSelect = null;
  if (typeof _unlockScroll === 'function') _unlockScroll();
}

// Mobile entry point for the log form's Marine life search — replaces the
// old fake text input (real typing was never possible there on mobile;
// focus/input always redirected here anyway before a keystroke could land).
// A real button that says so, rather than an input inviting a keystroke
// it can't accept.
function openMobileSpeciesSearch() {
  const siteCtx = document.getElementById('f-site')?.value || '';
  showMobileSpeciesPicker(sp => { addSighting({ ...sp }); }, 'LOG DIVE', siteCtx);
}

// Called via onmousedown on a photo cell — preventDefault keeps input focused.
function _mspPickSpecies(el) {
  if (!_mspOnSelect) return;
  const sp = {
    scientificName: el.dataset.sci    || '',
    commonName:     el.dataset.common || '',
    aphiaId:        el.dataset.aphia  ? +el.dataset.aphia : null,
    group:          el.dataset.group  || '',
    validated:      !!el.dataset.aphia,
  };
  if (el.dataset.custom) sp.customId = el.dataset.custom;
  _mspOnSelect(sp);
  closeMobileSpeciesPicker();
}

// Add whatever is typed as a free-text sighting.
function _mspAddFreeText() {
  const val = (document.getElementById('smo-search')?.value || '').trim();
  if (!val) return;
  const customId = resolveCustomId(val);
  if (_mspOnSelect) _mspOnSelect({ scientificName: val, commonName: val,
                                   aphiaId: null, group: '', validated: false, customId });
  closeMobileSpeciesPicker();
}

// Tab switch — clears search and re-renders for the new group.
function setMobSpTab(group) {
  _mspGroup = group;
  const ov = document.getElementById('sp-mob-overlay');
  if (!ov || ov.style.display === 'none') return;
  _mspDisconnectObs();
  ov.innerHTML = _mspOverlayHtml('');
  _renderSpeciesFilterBanners();
  const resultsEl = ov.querySelector('.fmp-results');
  if (resultsEl) resultsEl.scrollTop = 0;
  if (_mspFullList.length > _mspBatch) _mspWatchSentinel();
}

// Live search — updates grid in-place, hides tabs during search, scrolls to top.
function onMobSpInput() {
  const q = (document.getElementById('smo-search')?.value || '').trim();
  _mspDisconnectObs();
  _mspBatch    = 60;
  _mspFullList = [];

  const isSearch = q.length >= 2;
  let visible;
  if (isSearch) {
    visible = searchLocalSpecies(q, _speciesRegionFilter && _speciesRegionFilter.regions);
  } else {
    _mspFullList = SPECIES_DB
      .filter(s => s[3] === _mspGroup && _rowPassesRegionFilter(s))
      .map(s => ({ commonName: s[0], scientificName: s[1], aphiaId: s[2],
                   group: s[3], photoUrl: s[4] || '', iucnStatus: s[5] || '' }))
      .sort((a, b) => a.commonName.localeCompare(b.commonName));
    visible = _mspFullList.slice(0, _mspBatch);
  }

  const hasMore   = _mspFullList.length > _mspBatch;
  const cellsHtml = visible.map(_mspCellHtml).join('');

  const grid = document.querySelector('#sp-mob-overlay .sp-grid-1col');
  if (grid) {
    grid.innerHTML = cellsHtml || _mspEmptyStateHtml(q, isSearch);
    if (hasMore) grid.insertAdjacentHTML('beforeend',
      '<div id="smo-sentinel" class="sp-load-sentinel"></div>');
  }

  _mspSyncTabsVisibility();

  const resultsEl = document.querySelector('#sp-mob-overlay .fmp-results');
  if (resultsEl) resultsEl.scrollTop = 0;

  if (hasMore) _mspWatchSentinel();
}

function _mspWatchSentinel() {
  const sentinel = document.getElementById('smo-sentinel');
  const scrollEl = document.querySelector('#sp-mob-overlay .fmp-results');
  if (!sentinel || !scrollEl) return;
  _mspObs = new IntersectionObserver(entries => {
    if (!entries[0].isIntersecting) return;
    _mspDisconnectObs();
    _mspAppendBatch();
  }, { root: scrollEl, threshold: 0 });
  _mspObs.observe(sentinel);
}

function _mspAppendBatch() {
  const grid = document.querySelector('#sp-mob-overlay .sp-grid-1col');
  const old  = document.getElementById('smo-sentinel');
  if (!grid) return;
  if (old) old.remove();
  const next = _mspFullList.slice(_mspBatch, _mspBatch + 60);
  _mspBatch += 60;
  next.forEach(r => grid.insertAdjacentHTML('beforeend', _mspCellHtml(r)));
  if (_mspFullList.length > _mspBatch) {
    grid.insertAdjacentHTML('beforeend', '<div id="smo-sentinel" class="sp-load-sentinel"></div>');
    _mspWatchSentinel();
  }
}

