// Dive planning (v2.6). Classic script — global functions, no deps, loaded after
// app.js. Phase 2.54: moon phase → neaps/springs (pure, offline, any date).
//
// Tides/weather/sea-state and the surface-interval calculator are added in later
// phases (2.55–2.57); see v2.6-BRIEF-dive-planning.md.

// Synodic month (new-moon → new-moon), days.
const PLN_SYNODIC = 29.530588853;
// Reference new moon: 2000-01-06 18:14 UTC (standard astronomical epoch).
const PLN_NEW_MOON_EPOCH = Date.UTC(2000, 0, 6, 18, 14, 0);

const PLN_MOON_NAMES = [
  'New moon', 'Waxing crescent', 'First quarter', 'Waxing gibbous',
  'Full moon', 'Waning gibbous', 'Last quarter', 'Waning crescent',
];

// Accepts a Date or a 'YYYY-MM-DD' string (anchored to local noon so the day is
// stable regardless of timezone). Returns { phase, illumination, name }.
//   phase: 0..1  (0 = new, 0.25 = first quarter, 0.5 = full, 0.75 = last quarter)
//   illumination: 0..1 fraction of the disc lit
function moonPhase(date) {
  const t = (date instanceof Date) ? date : new Date(String(date) + 'T12:00:00');
  if (isNaN(t)) return { phase: 0, illumination: 0, name: '' };
  const days = (t.getTime() - PLN_NEW_MOON_EPOCH) / 86400000;
  let phase = (days % PLN_SYNODIC) / PLN_SYNODIC;
  if (phase < 0) phase += 1;
  const illumination = (1 - Math.cos(2 * Math.PI * phase)) / 2;
  const name = PLN_MOON_NAMES[Math.round(phase * 8) % 8];
  return { phase, illumination, name };
}

// Spring/neap from the sun–moon elongation: springs at new & full (aligned),
// neaps at the quarters (perpendicular). springIndex 1 = full springs, 0 = full
// neaps. Threshold bands give a roughly 3-4 day "springs"/"neaps" window each.
//
// CAVEAT: peak springs lag the new/full moon by ~1-2 days ("age of the tide"),
// and that lag is location-specific — so this nails the *week* (springs vs neaps)
// but not the exact peak day. Precise heights/times come from the tide API
// (Admiralty, desktop) in phase 2.57.
function tideClass(date) {
  const { phase } = moonPhase(date);
  const springIndex = Math.abs(Math.cos(2 * Math.PI * phase));
  const cls = springIndex > 0.7 ? 'spring' : (springIndex < 0.3 ? 'neap' : 'mid');
  return { class: cls, springIndex };
}

// ── Plan panel (phase 2.54): neaps/springs calendar + selected-day readout ────
// Moon phase needs no location, so this whole panel is offline + cross-platform.
// Location, tide times, wind/sea and the surface-interval calc arrive in 2.55+.

let _planMonth = null;     // Date anchored to the 1st of the displayed month
let _planSelected = null;  // 'YYYY-MM-DD' selected day

// Moon event glyphs (v2.70+: drawn discs, not emoji — consistent across platforms)
const PLAN_MOON_TITLE = { New: 'New moon', Full: 'Full moon', '1Q': 'First quarter', '3Q': 'Last quarter' };

function _planMoonDisc(ev) {
  const cls = { New: 'new', Full: 'full', '1Q': 'fq', '3Q': 'lq' }[ev] || 'new';
  return '<span class="pd-moon-disc ' + cls + '" title="' + esc(PLAN_MOON_TITLE[ev] || '') + '"></span>';
}

function _planYmd(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0')
       + '-' + String(d.getDate()).padStart(2, '0');
}
function _phaseAt(y, m, day) { return moonPhase(new Date(y, m, day, 12, 0, 0)).phase; }

// Moon event on a given day (compared to the day before): '', New, Full, 1Q, 3Q.
function _planMoonEvent(y, m, day) {
  const p = _phaseAt(y, m, day), prev = _phaseAt(y, m, day - 1);
  if (prev > p) return 'New';
  if (prev < 0.5 && p >= 0.5) return 'Full';
  if (prev < 0.25 && p >= 0.25) return '1Q';
  if (prev < 0.75 && p >= 0.75) return '3Q';
  return '';
}

function renderPlanPanel() {
  const root = document.getElementById('plan-root');
  if (!root) return;
  const today = new Date();
  if (!_planMonth) _planMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  if (!_planSelected) _planSelected = _planYmd(today);
  root.innerHTML = '<div class="plan-layout">'
    + '<div class="plan-col-cal">' + _planCalHtml() + _planDayCardHtml() + '</div>'
    + '<div class="plan-col-side">' + _planSurfaceHtml() + '</div>'
    + '</div>';
}

function _planCalHtml() {
  const y = _planMonth.getFullYear(), m = _planMonth.getMonth();
  const monthName = _planMonth.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const lead = (new Date(y, m, 1).getDay() + 6) % 7;   // Monday-first
  const days = new Date(y, m + 1, 0).getDate();
  const todayYmd = _planYmd(new Date());

  let cells = '';
  for (let i = 0; i < lead; i++) cells += '<div class="plan-day empty"></div>';
  for (let day = 1; day <= days; day++) {
    const dStr = y + '-' + String(m + 1).padStart(2, '0') + '-' + String(day).padStart(2, '0');
    const tc = tideClass(dStr).class;
    const ev = _planMoonEvent(y, m, day);
    const sel = dStr === _planSelected ? ' selected' : '';
    const tod = dStr === todayYmd ? ' today' : '';
    cells += '<button class="plan-day ' + tc + sel + tod + '" onclick="planSelectDay(\'' + dStr + '\')">'
      + '<span class="pd-num">' + day + '</span>'
      + (ev ? _planMoonDisc(ev) : '')
      + '</button>';
  }
  const wd = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
    .map(w => '<div class="plan-wd mono-dim-sm">' + w + '</div>').join('');
  return '<div class="plan-cal">'
    + '<div class="plan-cal-head">'
    +   '<button class="plan-nav" onclick="planShiftMonth(-1)" aria-label="Previous month">‹</button>'
    +   '<span class="plan-month">' + monthName + '</span>'
    +   '<button class="plan-nav" onclick="planShiftMonth(1)" aria-label="Next month">›</button>'
    + '</div>'
    + '<div class="plan-cal-grid plan-wd-row">' + wd + '</div>'
    + '<div class="plan-cal-grid">' + cells + '</div>'
    + '<div class="plan-legend">'
    +   '<span><span class="lg spring"></span> Springs</span>'
    +   '<span><span class="lg mid"></span> Mid</span>'
    +   '<span><span class="lg neap"></span> Neaps</span>'
    +   '<span class="plan-moonkey-discs">'
    +     '<span class="pd-moon-disc new" style="display:inline-block;vertical-align:middle;margin-right:2px;"></span>'
    +     '<span class="pd-moon-disc full" style="display:inline-block;vertical-align:middle;margin-right:5px;"></span>'
    +     'new &amp; full → springs · '
    +     '<span class="pd-moon-disc fq" style="display:inline-block;vertical-align:middle;margin:0 2px 0 4px;"></span>'
    +     '<span class="pd-moon-disc lq" style="display:inline-block;vertical-align:middle;margin-right:4px;"></span>'
    +     'quarters → neaps'
    +   '</span>'
    + '</div>'
    + '</div>';
}

function planShiftMonth(delta) {
  _planMonth = new Date(_planMonth.getFullYear(), _planMonth.getMonth() + delta, 1);
  renderPlanPanel();
}
function planSelectDay(dStr) {
  _planSelected = dStr;
  renderPlanPanel();
}

// ── Location + conditions (phase 2.55): Open-Meteo wind + sea state (keyless) ──
// Location uses a general Nominatim geocode (any coastal town/site, not just
// OSM dive-tagged) plus the user's logged sites as quick-picks. Wind/waves are
// daily-max from Open-Meteo, ~16 days ahead; beyond that, only tides/moon apply.

// Saved location slots (up to 5). _planLat/_planLng/_planLocName are derived.
let _planLocations = (function() {
  try { return JSON.parse(localStorage.getItem('divelog-plan-locations') || '[]').filter(l => l.name && l.lat != null && l.lng != null); }
  catch(e) { return []; }
})();
let _planActiveLocIdx = 0;
let _planLocSearchOpen = _planLocations.length === 0;  // open search immediately if no locations saved
let _planLat = null, _planLng = null, _planLocName = '';
function _planSyncActiveLoc() {
  const loc = _planLocations[_planActiveLocIdx] || null;
  _planLat = loc ? loc.lat : null;
  _planLng = loc ? loc.lng : null;
  _planLocName = loc ? loc.name : '';
}
function _planSaveLocs() {
  try { localStorage.setItem('divelog-plan-locations', JSON.stringify(_planLocations)); } catch(e) {}
}
_planSyncActiveLoc();
let _planCond = null;          // { key, byDate:{ 'YYYY-MM-DD': {windMax,gustMax,windDir,waveMax,swellMax,swellPeriod} } }
let _planCondLoading = false;
let _planLocDebounce = null;

function _jsStr(s) { return String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/'/g, "\\'"); }
function _planWindLimit() { return parseInt(localStorage.getItem('divelog-wind-threshold-kn'), 10) || 25; }
function _windDirAbbr(deg) {
  if (deg == null || isNaN(deg)) return '';
  return ['N','NE','E','SE','S','SW','W','NW'][Math.round(deg / 45) % 8];
}
// Arrow points the direction wind blows TO (deg is FROM, so rotate +180°)
function _windDirArrow(deg) {
  if (deg == null || isNaN(deg)) return '';
  const rot = Math.round((deg + 180) % 360);
  return '<span class="pc-dir-arrow" style="transform:rotate(' + rot + 'deg)">↑</span>';
}

function _planLocSectionHtml() {
  const hasPills = _planLocations.length > 0;
  const pillsHtml = hasPills
    ? '<div class="pdc-loc-pills">'
      + _planLocations.map(function(loc, i) {
          const active = i === _planActiveLocIdx;
          const label = loc.name.split(',')[0].trim();
          return '<button class="pdc-loc-pill' + (active ? ' active' : '') + '" onclick="planLocSelect(' + i + ')">'
            + '<span class="pdc-loc-pill-name">' + esc(label) + '</span>'
            + '<span class="pdc-loc-pill-x" onclick="planLocRemove(' + i + ',event)" title="Remove">×</span>'
            + '</button>';
        }).join('')
      + (_planLocations.length < 5 && !_planLocSearchOpen
          ? '<button class="pdc-loc-add" onclick="planLocAddOpen()">＋</button>'
          : '')
      + '</div>'
    : '';
  const searchHtml = (!hasPills || _planLocSearchOpen)
    ? '<div class="pdc-loc-search">'
      + (hasPills
          ? '<div class="pdc-loc-search-head">'
            + '<span class="pdc-loc-search-label">Add location</span>'
            + '<button class="pdc-loc-close" onclick="planLocAddClose()">✕</button>'
            + '</div>'
          : '')
      + '<input id="plan-loc-input" class="plan-loc-input" type="text" autocomplete="off"'
      + ' placeholder="Search a dive site or place…" oninput="planLocInput()">'
      + '<div id="plan-loc-dd" class="plan-loc-dd"></div>'
      + '</div>'
    : '';
  return '<div class="pdc-locs">' + pillsHtml + searchHtml + '</div>';
}

function planLocInput() {
  const input = document.getElementById('plan-loc-input');
  const dd = document.getElementById('plan-loc-dd');
  if (!input || !dd) return;
  const val = input.value.trim();
  clearTimeout(_planLocDebounce);
  if (val.length < 3) { dd.style.display = 'none'; dd.innerHTML = ''; return; }
  let histHtml = '';
  if (typeof searchSiteHistory === 'function') {
    histHtml = searchSiteHistory(val).filter(h => h.lat != null).slice(0, 4).map(h =>
      '<div class="plan-loc-item" onmousedown="planPickLocation(\'' + esc(_jsStr(h.site)) + '\',' + h.lat + ',' + h.lng + ')">📌 ' + esc(h.site) + '</div>'
    ).join('');
  }
  dd.innerHTML = histHtml + '<div class="plan-loc-msg">Searching…</div>';
  dd.style.display = 'block';
  _planLocDebounce = setTimeout(() => _planGeocode(val, histHtml), 400);
}

async function _planGeocode(val, histHtml) {
  const dd = document.getElementById('plan-loc-dd');
  if (!dd) return;
  let results = [];
  try {
    results = await fetch('https://nominatim.openstreetmap.org/search?' + new URLSearchParams({
      q: val, format: 'json', limit: '6', 'accept-language': 'en'
    })).then(r => r.json());
  } catch (e) { /* offline / blocked — history-only */ }
  const items = (results || []).slice(0, 6).map(r => {
    const n = (r.display_name || '').split(',').slice(0, 2).join(',').trim();
    return '<div class="plan-loc-item" onmousedown="planPickLocation(\'' + esc(_jsStr(n)) + '\',' + parseFloat(r.lat) + ',' + parseFloat(r.lon) + ')">' + esc(n) + '</div>';
  }).join('');
  dd.innerHTML = histHtml + (items || '<div class="plan-loc-msg">No matches — try a nearby town</div>');
  dd.style.display = 'block';
}

function planPickLocation(name, lat, lng) {
  const existing = _planLocations.findIndex(function(l) { return l.name === name; });
  if (existing >= 0) {
    _planActiveLocIdx = existing;
  } else {
    _planLocations.push({ name: name, lat: lat, lng: lng });
    _planActiveLocIdx = _planLocations.length - 1;
  }
  _planSaveLocs();
  _planSyncActiveLoc();
  _planLocSearchOpen = false;
  _planCond = null;
  _planTide = null;
  renderPlanPanel();
  fetchPlanConditions();
  fetchPlanTide();
}

function planLocSelect(idx) {
  if (_planActiveLocIdx === idx) return;
  _planActiveLocIdx = idx;
  _planSyncActiveLoc();
  _planCond = null;
  _planTide = null;
  renderPlanPanel();
  fetchPlanConditions();
  fetchPlanTide();
}

function planLocRemove(idx, e) {
  if (e) e.stopPropagation();
  _planLocations.splice(idx, 1);
  _planSaveLocs();
  if (_planActiveLocIdx >= _planLocations.length) _planActiveLocIdx = _planLocations.length - 1;
  _planSyncActiveLoc();
  _planLocSearchOpen = _planLocations.length === 0;
  _planCond = null;
  _planTide = null;
  renderPlanPanel();
  if (_planLat != null) { fetchPlanConditions(); fetchPlanTide(); }
}

function planLocAddOpen()  { _planLocSearchOpen = true;  renderPlanPanel(); setTimeout(function() { var el = document.getElementById('plan-loc-input'); if (el) el.focus(); }, 0); }
function planLocAddClose() { _planLocSearchOpen = false; renderPlanPanel(); }

async function fetchPlanConditions() {
  if (_planLat == null) return;
  const key = _planLat.toFixed(3) + ',' + _planLng.toFixed(3);
  // Data covers 16 days so a day change never needs a re-fetch — just re-render.
  if (_planCond && _planCond.key === key) { renderPlanPanel(); return; }
  _planCondLoading = true;
  renderPlanPanel();
  const fUrl = 'https://api.open-meteo.com/v1/forecast?' + new URLSearchParams({
    latitude: _planLat, longitude: _planLng,
    daily: 'wind_speed_10m_max,wind_gusts_10m_max,wind_direction_10m_dominant',
    wind_speed_unit: 'kn', timezone: 'auto', forecast_days: '16'
  });
  const mUrl = 'https://marine-api.open-meteo.com/v1/marine?' + new URLSearchParams({
    latitude: _planLat, longitude: _planLng,
    daily: 'wave_height_max,swell_wave_height_max,swell_wave_period_max',
    timezone: 'auto', forecast_days: '8'
  });
  const byDate = {};
  try {
    const [fd, md] = await Promise.all([
      fetch(fUrl).then(r => r.json()).catch(() => null),
      fetch(mUrl).then(r => r.json()).catch(() => null),
    ]);
    if (fd && fd.daily) fd.daily.time.forEach((t, i) => {
      (byDate[t] = byDate[t] || {});
      byDate[t].windMax = fd.daily.wind_speed_10m_max[i];
      byDate[t].gustMax = fd.daily.wind_gusts_10m_max[i];
      byDate[t].windDir = fd.daily.wind_direction_10m_dominant[i];
    });
    if (md && md.daily) md.daily.time.forEach((t, i) => {
      (byDate[t] = byDate[t] || {});
      byDate[t].waveMax = md.daily.wave_height_max[i];
      byDate[t].swellMax = md.daily.swell_wave_height_max[i];
      byDate[t].swellPeriod = md.daily.swell_wave_period_max[i];
    });
  } catch (e) { /* leave byDate empty → "no forecast" state */ }
  _planCond = { key, byDate };
  _planCondLoading = false;
  renderPlanPanel();
}

function planSetWindLimit(v) {
  const n = parseInt(v, 10);
  if (n >= 5 && n <= 60) { localStorage.setItem('divelog-wind-threshold-kn', n); renderPlanPanel(); }
}

// ── Surface-interval calculator (phase 2.56, deco stops added 2026-07) ─────
// Vendored Bühlmann ZHL-16C engine (MIT, jirkapok/GasPlanner — see
// vendor/scuba-physics/README.md for provenance + validation). Two presets
// (divelog-conservatism: standard|extra) — Standard is GF 100/100 (the raw
// ceiling, no added margin), Conservative is GF 40/85. GF 100/100 as
// Standard is a deliberate, knowing override of an earlier "never loosen
// this, ever" rule — see DECISIONS.md → "GF 100/100 as Standard" for the
// full justification (real-world comparisons against a Cressi Leonardo, a
// BSAC 88 table, and Subsurface's own documented usage all pointed the same
// direction) before touching these values again.
// A dive that exceeds NDL is never hard-blocked: it's given a real stop
// schedule (depth + minutes, extracted from BuhlmannAlgorithm.decompression()
// — the same call already needed for tissue-chaining between dives, see
// _planEvaluateDive below), the same way a BSAC/PADI table hands you a stop
// instead of refusing the dive. This tool advises, it never enforces — every
// plan can still be saved as entered. See DECISIONS.md → "Deco-stop planning".

let _spLoaded = false;
let _planDives = [];           // [{seq, depth, time, gas, entryTime}] — ephemeral, not persisted
let _planDiveSeq = 0;
let _planSurfaceResult = null; // last SurfacePlan computed by planRecalcSurface()
let _planSurfaceCalcLoading = false;
let _planAddOpen = false;      // whether the inline add-dive form is expanded

async function loadScubaPhysics() {
  if (_spLoaded || window.ScubaPhysics) { _spLoaded = true; return; }
  await new Promise((res, rej) => {
    const script = document.createElement('script');
    script.src = 'vendor/scuba-physics/scuba-physics.min.js';
    script.onload = res; script.onerror = rej;
    document.head.appendChild(script);
  });
  _spLoaded = true;
}

// GF 100/100 as Standard — a deliberate, knowing override of the previous
// "locked to 40/85 / 35/75, no looser option, ever" rule (DECISIONS.md →
// "GF 100/100 as Standard"). GF 100/100 is the raw Bühlmann ceiling with no
// added margin — Subsurface's own manual: "to approximate the values in
// recreational dive tables, set the gradient factors to 100." It's a hard
// floor (nothing looser exists within this model), not an open door.
// Conservative (40/85) is what used to be Standard — now explicitly framed
// as the added-margin option, its original intended meaning.
function _planGf() {
  const c = localStorage.getItem('divelog-conservatism') || 'standard';
  return c === 'extra' ? [0.40, 0.85] : [1.0, 1.0];
}

function _planOptions() {
  const SP = window.ScubaPhysics;
  const [gfLow, gfHigh] = _planGf();
  const options = new SP.Options(gfLow, gfHigh, 1.4, 1.6, SP.Salinity.salt);
  // The engine's own default (SafetyStop.auto) adds a routine ~3 min stop at
  // the last stop depth on top of whatever a genuine decompression obligation
  // already requires there — confirmed by diffing segments with/without it
  // (a 23m/47min dive's 3m stop dropped from 15.18 to 12.18 min). A diver
  // doesn't do a habitual safety stop AND a required deco stop as separate,
  // additive things — the deco stop already serves that purpose. This tool
  // never mentions "safety stop" as its own concept anywhere else, so
  // disabling it here keeps the reported figure to the genuine obligation
  // only, matching what a BSAC/PADI table would call the required stop.
  options.safetyStop = SP.SafetyStop.never;
  return options;
}

function _planGasFor(label) {
  const SP = window.ScubaPhysics;
  const m = /nitrox\s*(\d+)/i.exec(label || '');
  if (m) {
    const pct = Math.min(100, Math.max(21, parseInt(m[1], 10)));
    return new SP.Gas(pct / 100, 0);
  }
  return SP.StandardGases.air;
}

function _planSegments(depth, time, gas, options) {
  const SP = window.ScubaPhysics;
  const segments = new SP.Segments();
  segments.add(depth, gas, SP.durationFor(depth, options.descentSpeed));
  segments.addFlat(gas, time * 60);
  return segments;
}

// Adds whole minutes to a 'HH:MM' string, wrapping past midnight — mirrors
// calcExitTime()'s math (app.js) so the two stay consistent.
function _planAddMinutes(hhmm, mins) {
  if (!hhmm) return null;
  const [h, m] = hhmm.split(':').map(Number);
  if (isNaN(h) || isNaN(m)) return null;
  const total = h * 60 + m + Math.round(mins);
  const eh = String(((Math.floor(total / 60) % 24) + 24) % 24).padStart(2, '0');
  const em = String(((total % 60) + 60) % 60).padStart(2, '0');
  return eh + ':' + em;
}

// Whole minutes elapsed from startHhmm to endHhmm, wrapping past midnight —
// the inverse of _planAddMinutes, same forward-only assumption (a plan's
// dives are always chronological).
function _planMinutesBetween(startHhmm, endHhmm) {
  if (!startHhmm || !endHhmm) return null;
  const [sh, sm] = startHhmm.split(':').map(Number);
  const [eh, em] = endHhmm.split(':').map(Number);
  if ([sh, sm, eh, em].some(isNaN)) return null;
  let diff = (eh * 60 + em) - (sh * 60 + sm);
  if (diff < 0) diff += 24 * 60;
  return diff;
}

// Extracts a stop schedule from a computed profile (CalculatedProfile.segments
// — vendor/scuba-physics, BuhlmannAlgorithm.decompression()). A "stop" is any
// flat segment (startDepth === endDepth) STRICTLY SHALLOWER than the dive's
// own planned depth — excluding maxDepth is what tells the planned bottom
// segment (also flat, also non-zero depth — otherwise indistinguishable from
// a real stop by shape alone) apart from a genuine ascent stop, which the
// algorithm always places shallower on its way up. The algorithm appends
// stop segments automatically — nothing here is hand-entered. Adjacent
// segments at the same depth (the algorithm can split one stop into more
// than one internal segment, e.g. around a gas check) are merged.
function _planExtractStops(result, maxDepth) {
  const stops = [];
  for (const seg of result.segments) {
    if (Math.abs(seg.endDepth - seg.startDepth) > 0.01) continue;   // not flat — a descent/ascent leg
    if (seg.startDepth <= 0.05) continue;                            // surface
    if (seg.startDepth >= maxDepth - 0.01) continue;                 // the planned bottom segment itself
    const depth = Math.round(seg.startDepth);
    const mins = seg.duration / 60;
    const last = stops[stops.length - 1];
    if (last && last.depth === depth) last.mins += mins; else stops.push({ depth, mins });
  }
  stops.forEach(s => { s.mins = Math.round(s.mins); });
  return stops.filter(s => s.mins > 0);
}

// Plain-language stop schedule, table-style: depth + minutes, in ascent
// order (SafetyStop.never in _planOptions — no routine safety-stop increment
// mixed into the genuine obligation, see there for why).
//
// An empty list here is a real, if narrow, case: noDecoLimit() rounds down
// to whole minutes as its own margin, so a dive can read as past the
// published NDL while the full ceiling computation still finds nothing to
// actually stop for — a diver right on the edge, not one who owes a stop.
// Reported honestly rather than claiming a stop that isn't there.
function _planDecoScheduleText(sched) {
  if (!sched || !sched.stops.length) return 'At your no-stop limit — no stop indicated, but you\'re right on the edge.';
  const parts = sched.stops.map(s => s.mins + ' min at ' + s.depth + ' m').join(', then ');
  return sched.stops.length > 1
    ? 'Requires stops: ' + parts + ' — ' + sched.totalMin + ' min total'
    : 'Requires a stop: ' + parts;
}

// The re-entry time shown to the diver. The real off-gassing figure is the
// primary value — shown as-is even when it's under an hour. The rule-of-thumb
// is a genuine FALLBACK, not a floor: it applies ONLY when the real figure is
// 0, i.e. the dive left negligible residual and rest makes no difference. That
// one case has no meaningful "wait" to recommend, so a flat conventional
// minimum interval stands in.
const PLAN_RULE_OF_THUMB_MIN = 60;
function _planDisplayInterval(realMin) {
  return (realMin == null || realMin <= 0) ? PLAN_RULE_OF_THUMB_MIN : realMin;
}

// ── Off-gassing recommendation (tissue-based, v2.95) ────────────────────────
// The re-entry recommendation is "how off-gassed is your body", NOT "when does
// the next dive fit within no-stop limits" (that has no answer for a dive
// that's a deco dive even fully rested). It reads the vendored engine's 16
// ZHL-16 tissue compartments directly: how much dissolved inert gas is still
// above the fully-rested surface baseline, and how long until 90% of it has
// cleared. That 90% figure is calibrated — for a hard single dive it lands
// near the BSAC 88 surface-interval table's "decent code" region (~4h from a
// code-G dive), NOT the ~10h that table needs to reach fully-clean code A,
// which no sports diver waits for. See DECISIONS.md → "Off-gassing recommendation".
const PLAN_OFFGAS_FRACTION = 0.90;

// Surface-equilibrium N2 partial pressure (bar) — the fully-off-gassed
// baseline every compartment decays toward. A physical constant for the
// planner's fixed conditions (sea-level salt water; surface breathing is
// always air regardless of the dive gas), so computed once and cached: take
// any dived tissue set, rest it effectively forever, read the settled pN2.
let _planCleanN2 = null;
function _planCleanBaselineN2(algorithm, options) {
  if (_planCleanN2 != null) return _planCleanN2;
  const settled = _planRestTissues(algorithm, options, _planProbeDiveTissues(algorithm, options), 100 * 3600);
  _planCleanN2 = settled.reduce((s, c) => s + c.pN2, 0) / settled.length;
  return _planCleanN2;
}

// A throwaway dive purely to obtain a loaded tissue set to rest (for the clean
// baseline). Any dive works — the 100h rest that follows erases all of it.
function _planProbeDiveTissues(algorithm, options) {
  const SP = window.ScubaPhysics;
  const gas = SP.StandardGases.air;
  const segs = new SP.Segments();
  segs.add(10, gas, SP.durationFor(10, options.descentSpeed));
  segs.addFlat(gas, 600);
  const gases = new SP.Gases(); gases.add(gas);
  return algorithm.decompression(SP.AlgorithmParams.forMultilevelDive(segs, gases, options, undefined)).finalTissues;
}

// Apply pure surface rest to a tissue set and return the resulting tissues.
// The engine only exposes rest via RestingParameters applied before a dive,
// so a negligible reference "dive" (~2 s at the surface) is appended — it
// changes the rested tissues immeasurably but lets us read them back.
function _planRestTissues(algorithm, options, tissues, restSec) {
  const SP = window.ScubaPhysics;
  const gas = SP.StandardGases.air;
  const rest = new SP.RestingParameters(tissues, restSec);
  const segs = new SP.Segments();
  segs.add(0.001, gas, 1);
  segs.addFlat(gas, 1);
  const gases = new SP.Gases(); gases.add(gas);
  return algorithm.decompression(SP.AlgorithmParams.forMultilevelDive(segs, gases, options, rest)).finalTissues;
}

// Total inert-gas over-pressure of a tissue set relative to the fully-rested
// surface baseline, summed across all 16 compartments (N2 + He; He is 0 for
// the app's air/nitrox gases). 0 = fully off-gassed.
function _planTissueOverpressure(tissues, cleanN2) {
  let sum = 0;
  for (const c of tissues) sum += Math.max(0, c.pN2 - cleanN2) + Math.max(0, c.pHe);
  return sum;
}

// Minutes of surface rest until PLAN_OFFGAS_FRACTION of a dive's residual
// over-pressure has cleared. Monotonic in rest time (off-gassing only lowers
// loading), so binary-searchable. 0 when the dive left negligible loading —
// the caller then shows the rule-of-thumb interval instead.
function _planOffgasMinutes(algorithm, options, tissues) {
  const cleanN2 = _planCleanBaselineN2(algorithm, options);
  const op0 = _planTissueOverpressure(tissues, cleanN2);
  if (op0 <= 0) return 0;
  const target = op0 * (1 - PLAN_OFFGAS_FRACTION);
  const opAt = (sec) => _planTissueOverpressure(_planRestTissues(algorithm, options, tissues, sec), cleanN2);
  if (opAt(0) <= target) return 0;
  let lo = 0, hi = 24 * 3600;
  for (let i = 0; i < 26; i++) { const mid = (lo + hi) / 2; if (opAt(mid) <= target) hi = mid; else lo = mid; }
  return Math.ceil(hi / 60);
}

// The % of a dive's residual over-pressure that would be cleared after a given
// surface rest — for the "you planned Xh · ~Y% off-gassed" contrast note.
function _planPctOffgassed(algorithm, options, tissues, restMin) {
  const cleanN2 = _planCleanBaselineN2(algorithm, options);
  const op0 = _planTissueOverpressure(tissues, cleanN2);
  if (op0 <= 0) return 100;
  const op = _planTissueOverpressure(_planRestTissues(algorithm, options, tissues, (restMin || 0) * 60), cleanN2);
  return Math.max(0, Math.min(100, Math.round(100 * (1 - op / op0))));
}

// Evaluates one planned dive against the tissues left by the previous dive
// (null for the first dive in the plan), at a given surface rest before it
// (usedRestMin — the diver's real planned gap when entry times are set, else
// an assumed rest passed by the caller). Returns the dive's own outcome:
// whether it fits within no-stop limits at that rest, and if not, the real
// stop schedule. Going in sooner is never blocked — this tool advises, it
// never enforces (DECISIONS.md). The surface-interval RECOMMENDATION is no
// longer computed here — it's a property of the PREVIOUS dive's residual
// (_planOffgasMinutes), handled by the caller.
function _planEvaluateDive(algorithm, prevTissues, depth, time, gas, options, usedRestMin) {
  const SP = window.ScubaPhysics;
  const usedRestSeconds = (usedRestMin || 0) * 60;
  const restFor = () => prevTissues ? new SP.RestingParameters(prevTissues, usedRestSeconds) : undefined;

  const ndlAtUsedRest = algorithm.noDecoLimit(SP.AlgorithmParams.forSimpleDive(depth, gas, options, restFor()));
  const withinNdl = time <= ndlAtUsedRest;

  const gases = new SP.Gases();
  gases.add(gas);
  const segments = _planSegments(depth, time, gas, options);
  const result = algorithm.decompression(SP.AlgorithmParams.forMultilevelDive(segments, gases, options, restFor()));
  const hasErrors = result.errors.length > 0;

  const decoSchedule = (!withinNdl && !hasErrors) ? (() => {
    const stops = _planExtractStops(result, depth);
    return { stops, totalMin: stops.reduce((n, s) => n + s.mins, 0) };
  })() : null;

  return { ndlAtUsedRest, withinNdl, decoSchedule, hasErrors, finalTissues: result.finalTissues };
}

// Format whole minutes as "1 h 20 min" or "45 min"
function _fmtInterval(mins) {
  if (!mins) return '0 min';
  const h = Math.floor(mins / 60), m = mins % 60;
  if (h > 0) return h + ' h' + (m > 0 ? ' ' + m + ' min' : '');
  return m + ' min';
}

// Clock time first — that's what's actually useful when planning a day
// against a schedule; the minute count is a hover title. A subtle "~90%
// off-gassed" note says what the re-entry time represents (see the
// off-gassing recommendation, above). When the dive left negligible residual
// (isRealOffgas false → rule-of-thumb fallback), there's no meaningful % —
// it's just a conventional minimum interval, so the note is omitted.
function _planReentryLabel(minMin, earliestReentry, pct, isRealOffgas) {
  const pctNote = isRealOffgas ? ' <span class="sp-tl-clears">· ~' + pct + '% off-gassed</span>' : '';
  const title = 'title="' + (isRealOffgas ? 'Rest to ~' + pct + '% off-gassed' : 'Rule-of-thumb minimum') + ': ' + _fmtInterval(minMin) + '"';
  const head = earliestReentry
    ? '<span ' + title + '>Re-entry ' + esc(earliestReentry) + '</span>'
    : '<span ' + title + '>Wait ' + _fmtInterval(minMin) + '</span>';
  return head + pctNote;
}

async function planCalculateSurfacePlan() {
  await loadScubaPhysics();
  const SP = window.ScubaPhysics;
  const algorithm = new SP.BuhlmannAlgorithm();
  const options = _planOptions();
  const [gfLow, gfHigh] = _planGf();

  let prevTissues = null, prevSeq = null, prevExitTime = null, lastEvaluated = null;
  const perDive = [], intervals = [];

  for (const d of _planDives) {
    const gas = _planGasFor(d.gas);
    const exitTime = _planAddMinutes(d.entryTime, d.time);

    // The recommended surface interval is a property of the PREVIOUS dive's
    // residual — how long until 90% of its tissue over-pressure has cleared —
    // computed here from prevTissues (the previous dive's finalTissues),
    // independent of this dive entirely. 0 for the first dive (no residual).
    const offgasMin = prevTissues ? _planOffgasMinutes(algorithm, options, prevTissues) : 0;

    // An actual surface interval only exists once both this dive and the
    // previous one have entry times set. Otherwise assume the diver waits the
    // recommended off-gas time — keeps the dive's own NDL/deco readout
    // consistent with the interval pill above it.
    const actualRestMin = (prevExitTime && d.entryTime) ? _planMinutesBetween(prevExitTime, d.entryTime) : null;
    const usedRestMin = actualRestMin != null ? actualRestMin : offgasMin;
    const ev = _planEvaluateDive(algorithm, prevTissues, d.depth, d.time, gas, options, usedRestMin);

    if (ev.hasErrors) {
      perDive.push({ seq: d.seq, ndlMin: ev.ndlAtUsedRest, withinNdl: false, decoSchedule: null, exitTime });
      break; // genuinely invalid input (e.g. gas/depth incompatible) — nothing further can be evaluated off it
    }
    if (prevTissues) {
      // dispMin (with the rule-of-thumb fallback baked in) drives the re-entry
      // time; realOffgasMin (0 = negligible loading, rest doesn't matter) is
      // what the "you planned less" note tests against, so it never warns
      // about undershooting a rule-of-thumb value that only exists because
      // rest was irrelevant. actualPct: how off-gassed the diver's real
      // planned gap actually gets them (for the contrast note).
      const dispMin = _planDisplayInterval(offgasMin);
      intervals.push({
        afterSeq: prevSeq,
        minSurfaceIntervalMin: dispMin,
        realOffgasMin: offgasMin,
        offgasPct: Math.round(PLAN_OFFGAS_FRACTION * 100),
        earliestReentry: prevExitTime ? _planAddMinutes(prevExitTime, dispMin) : null,
        actualRestMin,
        actualPct: actualRestMin != null ? _planPctOffgassed(algorithm, options, prevTissues, actualRestMin) : null,
      });
    }
    perDive.push({
      seq: d.seq, ndlMin: ev.ndlAtUsedRest, withinNdl: ev.withinNdl,
      decoSchedule: ev.decoSchedule, exitTime,
    });

    prevTissues = ev.finalTissues;
    prevSeq = d.seq;
    prevExitTime = exitTime;
    lastEvaluated = d; // only ever set on the non-error path — see nextDiveHint below
  }

  // "How long before I could dive again?" — shown prospectively next to
  // "+ Add dive", not just retroactively once a dive 3 has already been typed
  // in. The off-gas time of the LAST dive (prevTissues after the loop).
  // lastEvaluated guards the error case: if a dive broke the loop, prevTissues
  // belongs to the last successfully-evaluated dive, not the failed one.
  let nextDiveHint = null;
  if (lastEvaluated && prevTissues) {
    const offgasMin = _planOffgasMinutes(algorithm, options, prevTissues);
    const dispMin = _planDisplayInterval(offgasMin);
    nextDiveHint = {
      earliestReentry: prevExitTime ? _planAddMinutes(prevExitTime, dispMin) : null,
      minSurfaceIntervalMin: dispMin,
      offgasPct: Math.round(PLAN_OFFGAS_FRACTION * 100),
      realOffgasMin: offgasMin,
    };
  }

  return {
    gf: [gfLow, gfHigh],
    perDive,
    intervals,
    nextDiveHint,
    disclaimer: 'Planning estimate — your dive computer is the authority. Not a substitute for proper training, tables, or a computer.',
  };
}

async function planRecalcSurface() {
  if (!_planDives.length) { _planSurfaceResult = null; renderPlanPanel(); return; }
  _planSurfaceCalcLoading = true;
  renderPlanPanel();
  try {
    _planSurfaceResult = await planCalculateSurfacePlan();
  } catch (e) {
    _planSurfaceResult = null;
  }
  _planSurfaceCalcLoading = false;
  renderPlanPanel();
}

function planAddDive() {
  const depthEl = document.getElementById('sp-add-depth');
  const timeEl  = document.getElementById('sp-add-time');
  const gasEl   = document.getElementById('sp-add-gas');
  const entryEl = document.getElementById('sp-add-entry');
  const depth = parseFloat(depthEl.value);
  const time  = parseFloat(timeEl.value);
  if (!depth || depth <= 0 || !time || time <= 0) return;
  _planDiveSeq += 1;
  _planDives.push({ seq: _planDiveSeq, depth, time, gas: gasEl.value, entryTime: entryEl.value || null });
  _planAddOpen = false;
  renderPlanPanel();
  planRecalcSurface();
}

function planRemoveDive(seq) {
  _planDives = _planDives.filter(d => d.seq !== seq);
  renderPlanPanel();
  planRecalcSurface();
}

function planSetConservatism(val) {
  localStorage.setItem('divelog-conservatism', val);
  planRecalcSurface();
}

// Reordering changes the surface-interval chain (each dive's residual
// loading carries into the next), so both paths recalc, not just re-render.
let _planDragIndex = null;

function planDragStart(e, i) {
  _planDragIndex = i;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', String(i));   // required for DND to fire in all browsers
  e.currentTarget.classList.add('sp-dragging');
}

function planDragEnd(e) {
  e.currentTarget.classList.remove('sp-dragging');
}

function planDrop(e, i) {
  e.preventDefault();
  if (_planDragIndex === null || _planDragIndex === i) return;
  const src = _planDragIndex;
  const dst = i;
  // Move profile (depth/time/gas) only — entry times stay in their slots.
  // Build the new profile order by splicing the source index to the destination.
  const order = _planDives.map((_, idx) => idx);
  const [moved] = order.splice(src, 1);
  order.splice(dst, 0, moved);
  _planDives = _planDives.map((d, pos) => ({
    ...d,
    depth: _planDives[order[pos]].depth,
    time:  _planDives[order[pos]].time,
    gas:   _planDives[order[pos]].gas,
  }));
  _planDragIndex = null;
  renderPlanPanel();
  planRecalcSurface();
}

// Drag/arrows move only the PROFILE (depth, time, gas) between fixed entry-time
// slots. Entry times are anchored to their position in the sequence — they do not
// move with the profile. Use the edit button (✎) to change a slot's entry time.
function planMoveDive(i, dir) {
  const j = i + dir;
  if (j < 0 || j >= _planDives.length) return;
  const { depth: di, time: ti, gas: gi } = _planDives[i];
  const { depth: dj, time: tj, gas: gj } = _planDives[j];
  _planDives[i] = { ..._planDives[i], depth: dj, time: tj, gas: gj };
  _planDives[j] = { ..._planDives[j], depth: di, time: ti, gas: gi };
  renderPlanPanel();
  planRecalcSurface();
}

// Inline edit (one row at a time) — entry time is per-dive data, so it
// doesn't auto-adjust when dives are reordered; this is how to fix it up
// without deleting and re-adding.
let _planEditIndex = null;

function planStartEdit(i) {
  _planEditIndex = i;
  renderPlanPanel();
}

function planCancelEdit() {
  _planEditIndex = null;
  renderPlanPanel();
}

function planSaveEdit(i) {
  const depth = parseFloat(document.getElementById('sp-edit-depth-' + i).value);
  const time  = parseFloat(document.getElementById('sp-edit-time-' + i).value);
  const gas   = document.getElementById('sp-edit-gas-' + i).value;
  const entryTime = document.getElementById('sp-edit-entry-' + i).value || null;
  if (!depth || depth <= 0 || !time || time <= 0) return;
  _planDives[i] = { ..._planDives[i], depth, time, gas, entryTime };
  _planEditIndex = null;
  renderPlanPanel();
  planRecalcSurface();
}

function planOpenAdd()   { _planAddOpen = true;  renderPlanPanel(); }
function planCancelAdd() { _planAddOpen = false; renderPlanPanel(); }

function _planGasOptionsHtml(selected) {
  return ['Air', 'Nitrox 28', 'Nitrox 30', 'Nitrox 32', 'Nitrox 34', 'Nitrox 36']
    .map(g => '<option value="' + g + '"' + (g === selected ? ' selected' : '') + '>' + g + '</option>').join('');
}

// ── Surface interval panel — vertical timeline layout (v2.70) ────────────────
// Left column: pinned entry time. Centre column: connector line + dot.
// Right: dive card (depth·time·gas + NDL badge + ▲▼ + drag grip on desktop).
// Surface interval pills sit between rows in the connector column.

function _planSurfaceHtml() {
  const conservatism = localStorage.getItem('divelog-conservatism') || 'standard';
  const gfHtml = '<div class="sp-cons-pill">'
    + '<span class="scp-btn' + (conservatism === 'standard' ? ' active' : '') + '" title="GF 100/100" onclick="planSetConservatism(\'standard\')">Standard</span>'
    + '<span class="scp-btn' + (conservatism === 'extra' ? ' active' : '') + '" title="GF 40/85" onclick="planSetConservatism(\'extra\')">Conservative</span>'
    + '</div>';

  const r = _planSurfaceResult;
  let tlHtml = '';

  _planDives.forEach((d, i) => {
    const isLast = i === _planDives.length - 1;
    // The connector line still extends past the last dot when a "how long
    // before diving again" hint row follows it — only truly stops at the
    // very end of the timeline.
    const dotExtends = !isLast || !!(r && r.nextDiveHint);
    const pd = r && r.perDive[i];
    const iv = (r && i > 0) ? r.intervals[i - 1] : null;

    // Surface interval connector between dives
    if (i > 0) {
      // Once both dives have real entry times, the diver has already decided
      // the gap — showing the recommendation alongside it is redundant (which
      // number matters?) and was overflowing the pill. Replace, don't append:
      // "You planned X · ~Y% off-gassed" stands ALONE in that case, warn-
      // coloured only when it falls short of the real off-gassing figure
      // (realOffgasMin — not the displayed rule-of-thumb, so it never warns
      // about "undershooting" a 1h fallback that only exists because rest was
      // irrelevant). The consequence (lower NDL, possibly a stop) already
      // shows on the next dive's own card either way. Never a block.
      const hasActual = iv && iv.actualRestMin != null;
      const isShort = hasActual && iv.realOffgasMin > 0 && iv.actualRestMin < iv.realOffgasMin;
      const actualLabel = hasActual
        ? '<span class="' + (isShort ? 'sp-tl-shortwarn' : 'sp-tl-clears') + '">You planned ' + _fmtInterval(iv.actualRestMin)
          + (iv.actualPct != null ? ' · ~' + iv.actualPct + '% off-gassed' : '') + '</span>'
        : null;
      const ivMin = iv ? iv.minSurfaceIntervalMin : null;
      const ivLabel = actualLabel
        ? '↕ ' + actualLabel
        : (ivMin != null ? '↕ ' + _planReentryLabel(ivMin, iv.earliestReentry, iv.offgasPct, iv.realOffgasMin > 0) : (_planSurfaceCalcLoading ? '' : ''));
      tlHtml += '<div class="sp-tl-ivrow">'
        + '<div class="sp-tl-lcol sp-tl-lcol--mid"></div>'
        + '<div class="sp-tl-ivcell">' + (ivLabel ? '<span class="sp-tl-ivpill">' + ivLabel + '</span>' : '') + '</div>'
        + '</div>';
    }

    if (_planEditIndex === i) {
      tlHtml += '<div class="sp-tl-row">'
        + '<div class="sp-tl-lcol sp-tl-lcol--dot' + (dotExtends ? ' sp-tl-lcol--extend' : '') + '"><div class="sp-tl-dot"></div></div>'
        + '<div class="sp-tl-card sp-tl-card--edit">'
        +   '<input type="number" id="sp-edit-depth-' + i + '" class="sp-add-input" value="' + d.depth + '" min="1" max="50" placeholder="Depth m" aria-label="Planned depth in metres">'
        +   '<input type="number" id="sp-edit-time-' + i + '" class="sp-add-input" value="' + d.time + '" min="1" max="200" placeholder="Time min" aria-label="Planned bottom time in minutes">'
        +   '<input type="time" id="sp-edit-entry-' + i + '" class="sp-add-input" value="' + (d.entryTime || '') + '" aria-label="Planned entry time">'
        +   '<select id="sp-edit-gas-' + i + '" class="sp-add-input" aria-label="Planned gas mix">' + _planGasOptionsHtml(d.gas) + '</select>'
        +   '<div class="sp-tl-formactions">'
        +     '<button class="sp-dive-ok" onclick="planSaveEdit(' + i + ')">✓</button>'
        +     '<button class="sp-dive-cancel" onclick="planCancelEdit()">✕</button>'
        +   '</div>'
        + '</div>'
        + '</div>';
    } else {
      const ndlBadge = pd
        ? (pd.withinNdl
            ? '<span class="sp-badge ok">within ' + Math.round(pd.ndlMin) + ' min NDL</span>'
            : (pd.decoSchedule
                ? '<span class="sp-badge deco">' + esc(_planDecoScheduleText(pd.decoSchedule)) + '</span>'
                : '<span class="sp-badge exceeds">can\'t be planned' + (pd.ndlMin != null ? ' · NDL ' + Math.round(pd.ndlMin) + ' min' : '') + '</span>'))
        : '';
      const exceededHint = (pd && !pd.withinNdl)
        ? (!pd.decoSchedule
            ? '<div class="sp-tl-hint">This gas/depth combination can\'t be planned — check it\'s appropriate for this depth.</div>'
            : pd.decoSchedule.stops.length
              ? '<div class="sp-tl-hint">Not blocked — you can still save this plan. Shortening the bottom time or going shallower avoids the stop entirely. This doesn\'t know your gas supply — check you actually have enough to complete the stop.</div>'
              : '<div class="sp-tl-hint">A direct ascent (within normal ascent-rate limits) should be fine — this is just flagging that you\'ve passed the published no-stop limit.</div>')
        : '';
      const exitTime = d.entryTime ? _planAddMinutes(d.entryTime, d.time) : null;
      const timingHtml = d.entryTime
        ? '<div class="sp-tl-timing">' + esc(d.entryTime) + ' → ' + esc(exitTime) + '</div>'
        : '';
      const needsAttn = pd && !pd.withinNdl;
      const stateCls = needsAttn ? (pd.decoSchedule ? '--warn' : '--danger') : '';
      const dotCls = 'sp-tl-dot' + (stateCls ? ' sp-tl-dot' + stateCls : '');
      const cardCls = 'sp-tl-card' + (stateCls ? ' sp-tl-card' + stateCls : '');
      const lcol = 'sp-tl-lcol sp-tl-lcol--dot' + (dotExtends ? ' sp-tl-lcol--extend' : '');

      tlHtml += '<div class="sp-tl-row">'
        + '<div class="' + lcol + '"><div class="' + dotCls + '"></div></div>'
        + '<div class="' + cardCls + '" draggable="true"'
        +   ' ondragstart="planDragStart(event,' + i + ')" ondragover="event.preventDefault()"'
        +   ' ondrop="planDrop(event,' + i + ')" ondragend="planDragEnd(event)">'
        +   '<div class="sp-tl-cmain">'
        +     '<div class="sp-tl-reorder">'
        +       '<button class="sp-dive-move" onclick="planMoveDive(' + i + ',-1)" title="Move up"' + (i === 0 ? ' disabled' : '') + '>▲</button>'
        +       '<button class="sp-dive-move" onclick="planMoveDive(' + i + ',1)" title="Move down"' + (isLast ? ' disabled' : '') + '>▼</button>'
        +     '</div>'
        +     '<div class="sp-tl-info">'
        +       timingHtml
        +       '<div class="sp-tl-profile">' + d.depth + ' m · ' + d.time + ' min · ' + esc(d.gas) + '</div>'
        +       (ndlBadge ? '<div class="sp-tl-badges">' + ndlBadge + '</div>' : '')
        +       exceededHint
        +     '</div>'
        +     '<div class="sp-tl-actions">'
        +       '<button class="sp-dive-edit" onclick="planStartEdit(' + i + ')" title="Edit">✎</button>'
        +       '<button class="sp-dive-rm" onclick="planRemoveDive(' + d.seq + ')" title="Remove">✕</button>'
        +     '</div>'
        +     '<span class="sp-tl-grip">'
        +       '<span class="sp-grip-dot"></span><span class="sp-grip-dot"></span>'
        +       '<span class="sp-grip-dot"></span><span class="sp-grip-dot"></span>'
        +       '<span class="sp-grip-dot"></span><span class="sp-grip-dot"></span>'
        +     '</span>'
        +   '</div>'
        + '</div>'
        + '</div>';
    }
  });

  // "How long before I could dive again?" — shown prospectively, before dive
  // 3's own numbers exist, so it's a planning input rather than something
  // only revealed after typing a dive in to be told it was too soon.
  if (r && r.nextDiveHint) {
    const h = r.nextDiveHint;
    const label = '↕ ' + _planReentryLabel(h.minSurfaceIntervalMin, h.earliestReentry, h.offgasPct, h.realOffgasMin > 0);
    tlHtml += '<div class="sp-tl-ivrow">'
      + '<div class="sp-tl-lcol sp-tl-lcol--mid"></div>'
      + '<div class="sp-tl-ivcell"><span class="sp-tl-ivpill">' + label + '</span></div>'
      + '</div>';
  }

  // Add dive button / expanded form
  if (_planAddOpen) {
    tlHtml += '<div class="sp-tl-addform">'
      + '<input type="number" id="sp-add-depth" class="sp-add-input" placeholder="Depth m" min="1" max="50" aria-label="Planned depth in metres">'
      + '<input type="number" id="sp-add-time" class="sp-add-input" placeholder="Time min" min="1" max="200" aria-label="Planned bottom time in minutes">'
      + '<input type="time" id="sp-add-entry" class="sp-add-input" title="Entry time (optional)" aria-label="Planned entry time, optional">'
      + '<select id="sp-add-gas" class="sp-add-input" aria-label="Planned gas mix">' + _planGasOptionsHtml('Air') + '</select>'
      + '<div class="sp-tl-formactions">'
      +   '<button class="sp-dive-ok" onclick="planAddDive()">✓</button>'
      +   '<button class="sp-dive-cancel" onclick="planCancelAdd()">✕</button>'
      + '</div>'
      + '</div>';
  } else {
    tlHtml += '<div class="sp-tl-addbtnrow">'
      + '<div class="sp-tl-lcol"></div>'
      + '<button class="sp-tl-addbtn" onclick="planOpenAdd()">+ Add dive</button>'
      + '</div>';
  }

  const resultNote = r && r.perDive.length < _planDives.length
    ? '<div class="sp-result-note">Later dives can\'t be planned until this is resolved — check the gas is appropriate for this depth, or reduce depth/bottom time.</div>'
    : '';

  return '<div class="plan-surface">'
    + '<div class="plan-surface-head"><span>Surface intervals</span>' + gfHtml + '</div>'
    + '<div class="plan-surface-sub">Entry times are fixed anchors. ▲▼ or drag moves the depth·time·gas profile between slots — intervals recompute. Use ✎ to change a slot’s entry time.</div>'
    + (_planSurfaceCalcLoading && _planDives.length ? '<div class="sp-calc-loading">Calculating…</div>' : '')
    + '<div class="sp-tl">' + tlHtml + '</div>'
    + resultNote
    + '<div class="sp-disclaimer">Planning estimate — your dive computer is the authority. Not a substitute for proper training, tables, or a computer.</div>'
    + '</div>';
}

// ── Day card: unified date/tide/moon/conditions card (v2.70) ─────────────────
// Merges what was _planReadoutHtml + _planConditionsHtml into a single card.
// Verdict (Diveable/Marginal/Too windy) leads when conditions are available;
// the tide row uses Admiralty data on desktop, moon-phase classification everywhere.

function _planDayCardHtml() {
  const mp = moonPhase(_planSelected);
  const tc = tideClass(_planSelected);
  const d = new Date(_planSelected + 'T12:00:00');
  const dateStr = isNaN(d) ? _planSelected
    : d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });

  // Moon disc for header
  const ph = mp.phase;
  let moonCls = 'new';
  if (ph > 0.0625 && ph < 0.4375) moonCls = 'fq';
  else if (ph >= 0.4375 && ph <= 0.5625) moonCls = 'full';
  else if (ph > 0.5625 && ph < 0.9375) moonCls = 'lq';

  // Conditions for selected day
  const c = (_planCond && _planCond.byDate) ? _planCond.byDate[_planSelected] : null;

  // Verdict block — only when we have gust data
  let verdictHtml = '';
  if (c && c.gustMax != null) {
    const limit = _planWindLimit();
    const gust = c.gustMax;
    let vkey = 'ok', vlabel = 'Diveable',
        vdesc = 'Gusts to ' + Math.round(gust) + ' kn — within your ' + limit + ' kn threshold.';
    if (gust >= limit) {
      vkey = 'too-strong'; vlabel = 'Too windy';
      vdesc = 'Gusts to ' + Math.round(gust) + ' kn — above your ' + limit + ' kn threshold.';
    } else if (gust >= limit * 0.8) {
      vkey = 'marginal'; vlabel = 'Marginal';
      vdesc = 'Gusts to ' + Math.round(gust) + ' kn — close to your ' + limit + ' kn limit. Watchable, not a write-off.';
    }
    verdictHtml = '<div class="pdc-verdict pdc-verdict--' + vkey + '">'
      + '<span class="pdc-verdict-spine"></span>'
      + '<div class="pdc-verdict-body">'
      +   '<div class="pdc-verdict-label">' + vlabel + '</div>'
      +   '<div class="pdc-verdict-desc">' + esc(vdesc) + '</div>'
      + '</div></div>';
  } else if (_planCondLoading && !_planCond) {
    verdictHtml = '<div class="pdc-loading">Loading conditions…</div>';
  }

  // Tide row value (Admiralty on desktop if available, moon-phase otherwise)
  const tideValHtml = _planTideCardHtml(tc, mp);

  // Wind row
  let windRow = '';
  if (c) {
    const dir = _windDirAbbr(c.windDir);
    const arrow = _windDirArrow(c.windDir);
    windRow = '<div class="pdc-row">'
      + '<span class="pdc-lbl">Wind</span>'
      + '<div class="pdc-val">'
      +   '<div class="pdc-val-main">' + (c.gustMax != null ? Math.round(c.gustMax) : '–') + ' kn gusts' + (arrow ? ' ' + arrow : '') + '</div>'
      +   '<div class="pdc-sub">avg ' + (c.windMax != null ? Math.round(c.windMax) : '–') + ' kn' + (dir ? ' · from ' + dir : '') + '</div>'
      + '</div></div>';
  } else if (_planLat != null && !_planCondLoading) {
    windRow = '<div class="pdc-row">'
      + '<span class="pdc-lbl">Wind</span>'
      + '<div class="pdc-val pdc-val--muted">No forecast for this date — reaches ~16 days ahead.</div>'
      + '</div>';
  }

  // Sea row
  let seaRow = '';
  if (c && (c.swellMax != null || c.waveMax != null)) {
    seaRow = '<div class="pdc-row">'
      + '<span class="pdc-lbl">Sea</span>'
      + '<div class="pdc-val">'
      +   '<div class="pdc-val-main">' + (c.swellMax != null ? c.swellMax.toFixed(1) : '–') + ' m swell</div>'
      +   '<div class="pdc-sub">' + (c.swellPeriod != null ? Math.round(c.swellPeriod) + ' s period · ' : '') + 'wave ' + (c.waveMax != null ? c.waveMax.toFixed(1) + ' m' : '–') + '</div>'
      + '</div></div>';
  }

  // Footer: wind-limit input + pr-note
  const limit = _planWindLimit();
  const windInput = (windRow || seaRow)
    ? '<div class="pdc-wind-limit">Flag gusts above <input type="number" class="pc-limit" value="' + limit + '" min="5" max="60" onchange="planSetWindLimit(this.value)"> kn</div>'
    : '';
  const noLoc = !_planLat
    ? '<div class="pdc-noloc">Search a location above to see wind &amp; sea state.</div>'
    : '';
  const tideNote = _planTideNoteHtml();

  return '<div class="plan-daycard">'
    + _planLocSectionHtml()
    + '<div class="pdc-head">'
    +   '<div class="pdc-head-text">'
    +     '<div class="pdc-date">' + esc(dateStr) + '</div>'
    +   '</div>'
    +   '<div class="pdc-mooninfo">'
    +     '<span class="pd-moon-disc ' + moonCls + '" style="display:inline-block;vertical-align:middle;flex:none;"></span>'
    +     '<span class="pdc-moonname">' + esc(mp.name) + '</span>'
    +   '</div>'
    + '</div>'
    + verdictHtml
    + '<div class="pdc-rows">'
    +   '<div class="pdc-row"><span class="pdc-lbl">Tide</span><div class="pdc-val">' + tideValHtml + '</div></div>'
    +   windRow
    +   seaRow
    + '</div>'
    + noLoc
    + tideNote
    + windInput
    + '<div class="pr-note">Neaps/springs is approximate (±~1 day).</div>'
    + '</div>';
}

// ── Desktop tide times (phase 2.57) — Admiralty UK Tidal API via the Tauri
// Rust seam (CORS + key-exposure blocked in-browser, so this is desktop-only;
// browser/mobile keep the moon-phase neaps/springs from 2.54). Per Admiralty's
// own FAQ, the free Discovery tier prohibits caching/storing the data ("a
// breach of Copyright law") — so this never skips a fetch because a previous
// one is still around; every call to fetchPlanTide() hits the API again.
// _planTide only holds the most recent response long enough to render it.

let _planTide = null;        // most recent { stationId, stationName, events: [...] } | null
let _planTideLoading = false;
let _planTideError = null;
let _planTideOutOfRange = false;

function saveAdmiraltyKey() {
  const keyEl = document.getElementById('admiralty-apikey');
  if (keyEl) localStorage.setItem('divelog-admiralty-key', keyEl.value);
  _planTide = null;
  fetchPlanTide();
}

// Discovery's 607 stations are all UK/Ireland/Channel Islands — outside this
// box even the "nearest" station is hundreds of km away and useless, while
// still spending a call against the 10k/month quota. Checked before any
// invoke(), so an out-of-range location (Thailand, say) costs zero API
// calls. (fetch_tide_events also rejects on actual distance to the nearest
// station, as a backstop for anything that slips past this coarse box.)
function _isUkWaters(lat, lng) {
  return lat >= 49.5 && lat <= 61.0 && lng >= -11.0 && lng <= 2.0;
}

async function fetchPlanTide() {
  // isDesktopShell(), not isShell(): fetch_tide_events (src-tauri/src/lib.rs)
  // has no platform gate and would answer identically on Android, but
  // Admiralty is desktop-only BY DESIGN (CLAUDE.md v2.6), and isShell() alone
  // no longer encodes that now that Android is also a Tauri shell — this was
  // a real isShell()-ambiguity bug, not a technical limitation. See the fuller
  // comment at the twin site in js/app.js (Admiralty settings visibility).
  if (!isDesktopShell() || _planLat == null) { _planTide = null; _planTideError = null; _planTideOutOfRange = false; return; }

  _planTideOutOfRange = !_isUkWaters(_planLat, _planLng);
  if (_planTideOutOfRange) { _planTide = null; _planTideError = null; renderPlanPanel(); return; }

  const apiKey = (localStorage.getItem('divelog-admiralty-key') || '').trim();
  if (!apiKey) { _planTide = null; _planTideError = null; renderPlanPanel(); return; }

  // Session-only deduplication: the station response covers multiple days, so
  // switching the selected day or switching app tabs never warrants a new call.
  // _planTide._key is ephemeral (not persisted) — cleared whenever the location
  // changes (planPickLocation/planLocSelect both set _planTide = null first).
  const tideKey = _planLat.toFixed(3) + ',' + _planLng.toFixed(3);
  if (_planTide && _planTide._key === tideKey) { renderPlanPanel(); return; }

  _planTideLoading = true;
  _planTideError = null;
  renderPlanPanel();
  try {
    _planTide = await window.__TAURI__.core.invoke('fetch_tide_events', {
      lat: _planLat, lng: _planLng, apiKey,
    });
    if (_planTide) _planTide._key = tideKey;
  } catch (e) {
    _planTide = null;
    _planTideError = typeof e === 'string' ? e : 'Could not fetch tide times.';
  }
  _planTideLoading = false;
  renderPlanPanel();
}

// Pairs of adjacent events bracketing the selected day give that day's own
// range — a 7-day min/max would span across different spring/neap days and
// confirm nothing. 'YYYY-MM-DD' compared against the ISO timestamp's date.
function _planTideForSelectedDay() {
  if (!_planTide || !_planTide.events) return null;
  const dayEvents = _planTide.events.filter(e => e.timeISO.slice(0, 10) === _planSelected);
  if (!dayEvents.length) return null;
  const heights = dayEvents.map(e => e.heightM);
  const rangeM = Math.max(...heights) - Math.min(...heights);
  return { events: dayEvents, rangeM: dayEvents.length > 1 ? rangeM : null };
}

// Returns the tide value HTML for the pdc-row — Admiralty data on desktop if
// available for the selected day, moon-phase classification everywhere else.
function _planTideCardHtml(tc, mp) {
  const tideName = tc.class === 'spring' ? 'Spring tide'
                 : tc.class === 'neap'   ? 'Neap tide'
                 : 'Mid-range tide';

  if (isDesktopShell() && !_planTideOutOfRange && !_planTideLoading && !_planTideError && _planTide) {
    const day = _planTideForSelectedDay();
    if (day) {
      const evStr = day.events.map(e =>
        (e.type === 'high' ? '▲ ' : '▼ ') + e.timeISO.slice(11, 16) + ' ' + e.heightM.toFixed(1) + 'm'
      ).join('   ');
      return '<div class="pdc-val-main">' + tideName
        + (day.rangeM != null ? ' <span class="pdc-sub-inline">· range ' + day.rangeM.toFixed(1) + ' m</span>' : '')
        + '</div><div class="pdc-sub pdc-mono">' + evStr + '</div>';
    }
  }

  return '<div class="pdc-val-main">' + tideName + '</div>'
    + '<div class="pdc-sub">' + esc(mp.name) + ' · ' + Math.round(mp.illumination * 100) + '% lit</div>';
}

// Returns Admiralty-related notes (API key prompt, out-of-range, error, station
// name) to render under the pdc-rows. Empty string on web / when unnecessary.
function _planTideNoteHtml() {
  if (!isDesktopShell()) return '';
  if (_planTideOutOfRange) {
    return '<div class="pr-tide-note">Admiralty only covers UK, Ireland and the Channel Islands — '
      + 'no real tide times for this location. Moon-phase neaps/springs work anywhere.</div>';
  }
  const apiKey = (localStorage.getItem('divelog-admiralty-key') || '').trim();
  if (!apiKey) {
    return '<div class="pr-tide-note">Add a free Admiralty API key in Settings for real tide times (UK waters only).</div>';
  }
  if (_planTideLoading) return '<div class="pr-tide-note">Loading tide times…</div>';
  if (_planTideError) return '<div class="pr-tide-note error">' + esc(_planTideError) + '</div>';
  if (!_planTide) return '';
  const day = _planTideForSelectedDay();
  if (!day) {
    return '<div class="pr-tide-note">No tide events for this date — '
      + esc(_planTide.stationName) + ' covers today + 6 days. Moon-phase neaps/springs work for any date.</div>';
  }
  return '<div class="pr-tide-note">' + esc(_planTide.stationName) + ' (nearest Admiralty station)</div>';
}
