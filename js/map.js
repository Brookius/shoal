// Map panel (Leaflet) — extracted from index.html (modular migration, step 4).
// Classic script, loaded before the main inline script (shared global scope).
// Self-contained: private _leafletLoaded/_mapInstance; called via show('map') -> initMap().
// ── Map panel (Leaflet) ───────────────────────────────────────────────────

let _leafletLoaded = false;
let _mapInstance   = null;

async function loadLeaflet() {
  if (_leafletLoaded) return;
  await new Promise((res, rej) => {
    // Vendored (2.393) — was unpkg.com. Kills the app's only runtime
    // third-party dependency (supply-chain surface) and makes the map
    // library itself work offline. Cross-CDN hash-verified at vendoring.
    //
    // Both the stylesheet and the script must finish before this resolves.
    // Leaflet's default marker icon (the plain blue pin, used anywhere
    // L.marker() is called with no custom icon) auto-detects its own image
    // path by probing a hidden element's COMPUTED background-image — a rule
    // that only exists once leaflet.css has actually applied. Previously
    // this only awaited the <script>'s onload, firing the CSS <link> and
    // forgetting about it — usually invisible (both files are tiny and
    // something else in the app had normally already loaded Leaflet first),
    // but the first marker created in a session that wins the race against
    // the stylesheet gets a broken image for every marker, permanently
    // (the bad path is cached on L.Icon.Default for the rest of the page's
    // life). Confirmed via a real broken-marker report on a fresh session.
    const link   = document.createElement('link');
    link.rel     = 'stylesheet';
    link.href    = 'vendor/leaflet/leaflet.css';
    const script = document.createElement('script');
    script.src   = 'vendor/leaflet/leaflet.js';
    let cssDone = false, jsDone = false;
    const maybeResolve = () => { if (cssDone && jsDone) res(); };
    link.onload  = () => { cssDone = true; maybeResolve(); };
    link.onerror = rej;
    script.onload = () => { jsDone = true; maybeResolve(); };
    script.onerror = rej;
    document.head.appendChild(link);
    document.head.appendChild(script);
  });
  // Belt and braces on top of the ordering fix above: set the default marker
  // icon's base path explicitly instead of trusting Leaflet's CSS-probe
  // auto-detection at all — the standard fix for a self-hosted/vendored
  // Leaflet. Deliberately just `imagePath`, not full iconUrl/iconRetinaUrl/
  // shadowUrl overrides too — Leaflet's _getIconUrl() always prepends
  // Icon.Default.imagePath to whatever those resolve to (its own bare
  // filenames by default), so supplying full paths on top of a now-correct
  // auto-detected imagePath double-prefixed the URL instead of fixing it
  // (found live: marker-icon.png loaded from .../images/.../images/...).
  L.Icon.Default.imagePath = 'vendor/leaflet/images/';
  _leafletLoaded = true;
}

// Tear down the active map instance. Called when leaving map view in history.
function destroyMap() {
  if (_mapInstance) { _mapInstance.remove(); _mapInstance = null; }
}

async function initMap() {
  const subtitle = document.getElementById('map-subtitle');
  try {
    await loadLeaflet();
  } catch(e) {
    if (subtitle) subtitle.textContent = 'Could not load map library — check your connection.';
    return;
  }

  const container = document.getElementById('map-leaflet');
  if (!container) return;

  // Destroy existing instance before re-init (panel re-open)
  if (_mapInstance) { _mapInstance.remove(); _mapInstance = null; }

  _mapInstance = L.map('map-leaflet');
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 18
  }).addTo(_mapInstance);

  renderMapMarkers();
}

// ── Dive-type pin ──────────────────────────────────────────────────────────
// An L.divIcon, deliberately, NOT an L.circleMarker: an SVG shape can take a
// CSS `fill: var(--tc)` but never a background-image, so a circleMarker would
// forfeit the [data-tex] texture channel entirely — and a wordless swatch is
// precisely what that channel exists for. Real HTML also means no colour is
// ever resolved in JS here, so an open map re-colours by itself when the theme
// flips (no getComputedStyle snapshot to go stale — the failure mode
// _dfRerenderProfileIfOpen in js/history.js exists to work around).
//
// The className REPLACES Leaflet's own 'leaflet-div-icon', which is load-
// bearing rather than cosmetic — see .dv-pin in css/styles.css.
const _PIN_TAIL = 7;   // px of pointer below the circle — keep in step with .dv-pin::before/::after
function _typePinIcon(entry, texOn) {
  // Letters-only before this feeds a class name: dive.entry originates in
  // imported .md frontmatter. Same guard renderTlRow uses (js/history.js).
  // String(?? '') rather than (x || ''): a bare "entry:" YAML key parses to
  // [] (parseFrontmatter), which is truthy and has no .replace — throwing
  // TypeError on every render that reaches it. String() also folds that
  // array (and any other non-string shape) down to a plain string first.
  const t   = String(entry ?? '').replace(/[^A-Za-z]/g, '');
  const tex = (t && texOn && TYPE_TEXTURE[t]) ? TYPE_TEXTURE[t] : '';
  // Same reasoning as the .tex-types stat-bar bump (9px → 14px): a texture
  // needs room. JS-gated, not CSS-gated, because Leaflet writes the icon's
  // width/height inline from iconSize and inline beats any stylesheet.
  const S = texOn ? 22 : 18;
  return L.divIcon({
    className: 'dv-pin' + (t ? ' t-' + t : ''),
    html: tex ? `<i data-tex="${tex}"></i>` : '',
    iconSize:   [S, S],
    iconAnchor: [S / 2, S + _PIN_TAIL]   // tail tip, not centre — this pin points
  });
}

// Which type represents a site. Ties break on canonical ramp order so the
// same site always renders the same colour between reloads.
function _majorityType(groupDives) {
  // Object.create(null): a dive typed "constructor" would otherwise inherit
  // Object.prototype's constructor function as its starting count, and
  // `(fn || 0) + 1` string-concatenates into "function Object() {…}1".
  const counts = Object.create(null);
  groupDives.forEach(d => {
    const t = String(d.entry ?? '').replace(/[^A-Za-z]/g, '');
    counts[t] = (counts[t] || 0) + 1;
  });
  const order = Object.keys(TYPE_TEXTURE);
  const rank  = t => { const i = order.indexOf(t); return i === -1 ? 99 : i; };
  return Object.keys(counts).sort((a, b) => counts[b] - counts[a] || rank(a) - rank(b))[0] || '';
}

// Popup for one site: identity + majority type, then every dive there as a
// row that navigates into its dive file. The list is what makes grouping
// safe — a stacked pin would otherwise leave all but the topmost dive
// unreachable now that the pin is a navigation target.
const _POP_MAX_ROWS = 5;
function _sitePopupHtml(g) {
  const major  = _majorityType(g.dives);
  const sorted = g.dives.slice().sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  const head   = sorted[0];
  const where  = [head.region, head.location].filter(Boolean).map(esc).join(', ');
  const n      = sorted.length;
  // var() fallback, not a bare var(): an unrecognised type would otherwise
  // compute to transparent rather than the neutral.
  const pill = major
    ? `<span class="df-type-pill" style="background-color:var(--type-${major},var(--text-dim));--tc:var(--type-${major},var(--text-dim))">${esc(major)}</span>`
    : '';
  const rows = sorted.slice(0, _POP_MAX_ROWS).map(d => {
    const t    = String(d.entry ?? '').replace(/[^A-Za-z]/g, '');
    const meta = [d.date || '', d.depth ? '↓' + d.depth + 'm' : ''].filter(Boolean).join(' · ');
    return `<button type="button" class="map-pop-row" onclick="goToDiveFromMap(${d.id})">
        <span class="map-pop-num">#${esc(String(d.divenum || '—'))}</span>
        <span>${t ? esc(t) : '—'}</span>
        <span class="map-pop-meta">${esc(meta)}</span>
      </button>`;
  }).join('');
  const more = n > _POP_MAX_ROWS
    ? `<div class="map-pop-more">… ${n - _POP_MAX_ROWS} more — open the site from the timeline</div>` : '';
  return `<div style="min-width:200px">
      <div class="map-pop-head"><span class="map-pop-site">${esc(head.site) || 'Unknown site'}</span>${pill}</div>
      ${where ? `<div class="map-pop-where">${where}</div>` : ''}
      <div class="map-pop-count">${n} dive${n !== 1 ? 's' : ''} here</div>
      <div class="map-pop-list">${rows}</div>${more}
    </div>`;
}

// Legend. Required, not decorative: the map pin is the app's first surface
// where colour is the ONLY per-item encoding (every other --type-* site
// writes the type's name beside it), which is exactly the case
// "CLAUDE colour UI.md" says needs a key before it ships. Only types actually
// present, so it can never list a type with no pin; counts are of DIVES (the
// type mix of your diving is the point) and sum to #map-subtitle's figure.
function _addTypeLegend(mapInstance, mapped, texOn) {
  // Stashed on the map instance, not a module global: the History map and the
  // trip full-screen map are separate Leaflet instances sharing this function,
  // and a shared global would try to remove one map's control from the other.
  if (mapInstance._diveTypeLegend) {
    try { mapInstance.removeControl(mapInstance._diveTypeLegend); } catch (e) { /* already gone */ }
    mapInstance._diveTypeLegend = null;
  }
  const counts = Object.create(null);   // see _majorityType for why not {}
  mapped.forEach(d => {
    const t = String(d.entry ?? '').replace(/[^A-Za-z]/g, '');
    counts[t] = (counts[t] || 0) + 1;
  });
  const order = Object.keys(TYPE_TEXTURE);
  const rank  = t => { const i = order.indexOf(t); return i === -1 ? 99 : i; };
  const types = Object.keys(counts).sort((a, b) => counts[b] - counts[a] || rank(a) - rank(b));
  if (!types.length) return;

  const Legend = L.Control.extend({
    options: { position: 'topright' },  // zoom is topleft; attribution bottomright
    onAdd: function () {
      const box = L.DomUtil.create('div', 'map-legend');
      box.setAttribute('aria-label', 'Dive types on this map');
      box.innerHTML = types.map(t => {
        const tex = (t && texOn && TYPE_TEXTURE[t]) ? ` data-tex="${TYPE_TEXTURE[t]}"` : '';
        // The swatch is the only place a texture can be LEARNED — the pin
        // carries one but no word.
        return `<div class="map-legend-row">
            <span class="map-legend-sw${t ? ' t-' + t : ''}"${tex}></span>
            <span>${t ? esc(t) : 'Unspecified'}</span>
            <span class="map-legend-n">${counts[t]}</span>
          </div>`;
      }).join('');
      L.DomEvent.disableClickPropagation(box);
      L.DomEvent.disableScrollPropagation(box);
      return box;
    }
  });
  mapInstance._diveTypeLegend = new Legend();
  mapInstance._diveTypeLegend.addTo(mapInstance);
}

// mapInstance/diveList default to the full History "Map" view's own globals
// so the existing zero-arg call (initMap, below) is unaffected; passing both
// explicitly is what lets any other Leaflet instance (e.g. the trip map's
// full-screen view, js/history.js openTripMapView) reuse the exact same
// marker + popup + bounds-fitting behaviour instead of duplicating it.
function renderMapMarkers(mapInstance, diveList) {
  mapInstance = mapInstance || _mapInstance;
  diveList    = diveList || dives;
  if (!mapInstance) return;
  // Only the full-panel History map has a #map-subtitle — looking it up
  // unconditionally is safe, it's just absent (and this no-ops) elsewhere.
  const subtitle = document.getElementById('map-subtitle');
  const mapped   = diveList.filter(d => d.gps_lat && d.gps_lng);

  if (!mapped.length) {
    mapInstance.setView([5, 115], 4); // Default view: SE Asia
    if (subtitle) subtitle.textContent = 'No dives with GPS coordinates yet — add coordinates when logging.';
    return;
  }

  // Read once, not per marker.
  const texOn = (typeof _texTypesOn === 'function') && _texTypesOn();

  // ONE PIN PER SITE, not per dive. Dives stacked at the same coordinates
  // would leave only the topmost tappable, and the pin is a navigation target
  // now — so grouping removes the overlap by construction rather than
  // mitigating it with draw order. Same 4dp rounding js/album.js already uses
  // to dedup sighting sites.
  const groups = new Map();
  mapped.forEach(d => {
    const lat = parseFloat(d.gps_lat);
    const lng = parseFloat(d.gps_lng);
    if (isNaN(lat) || isNaN(lng)) return;
    const key = lat.toFixed(4) + ',' + lng.toFixed(4);
    let g = groups.get(key);
    if (!g) { g = { lat: lat, lng: lng, dives: [] }; groups.set(key, g); }
    g.dives.push(d);
  });

  if (subtitle) {
    const nD = mapped.length, nS = groups.size;
    subtitle.textContent = `${nD} dive${nD !== 1 ? 's' : ''} at ${nS} site${nS !== 1 ? 's' : ''}`;
  }

  const bounds = [];
  groups.forEach(g => {
    const major = _majorityType(g.dives);
    const title = `${g.dives[0].site || 'Unknown site'} — ${g.dives.length} dive${g.dives.length !== 1 ? 's' : ''}`;
    L.marker([g.lat, g.lng], {
      icon: _typePinIcon(major, texOn),
      // divIcons get role="button" + tabIndex=0 from Leaflet but no accessible
      // name (alt is only applied to IMG icons), so without this every pin
      // announces as "Marker".
      title: title
    }).addTo(mapInstance).bindPopup(_sitePopupHtml(g));
    bounds.push([g.lat, g.lng]);
  });

  _addTypeLegend(mapInstance, mapped, texOn);

  if (bounds.length === 1) mapInstance.setView(bounds[0], 13);
  else mapInstance.fitBounds(bounds, { padding: [50, 50] });
}

// Tap-through from a pin's popup into the dive file. Two branches, because
// the two map surfaces tear down differently and getting it wrong either
// leaks a live Leaflet instance or corrupts the history stack:
//   · History Map view — a VIEW MODE, not an overlay. setHistoryView('list')
//     is what calls destroyMap() (js/app.js).
//   · Trip full-screen map — IS on the overlay stack (openTripMapView pushes
//     { type: 'tripMap' }), so it needs the same unwind goToDiveFromSpecies
//     does (js/album.js).
function goToDiveFromMap(diveId) {
  const top = _openOverlays.length ? _openOverlays[_openOverlays.length - 1] : null;
  if (top && top.type === 'tripMap') {
    _openOverlays.pop();
    closeTripMapViewDirect();
    _showFromPopstate = true;
    show('history');
    _showFromPopstate = false;
  } else {
    setHistoryView('list');
  }
  openDiveFile(diveId);
}
