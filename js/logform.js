// js/logform.js — Log-form redesign wiring (v2.74; edit modal retired v2.83)
// Classic script, loaded AFTER app.js + map.js so their globals exist at call-time.
//
// The redesigned controls (dive-type colour chips, segmented toggles, vis/temp
// dials, weather icons, an in-form Leaflet pin map) write into the SAME canonical
// inputs the rest of the app already reads. They're driven by a PREFIX — only
// 'f' (the log form, #panel-log) exists today; the parameterisation stays so a
// second form context can be wired without duplicating this file. saveDive()/
// markdown generation are untouched — this file only paints UI ⇄ those inputs.
// The desktop two-column rail is form-only. Editing an existing dive happens on
// this same form (edit mode, app.js) — see BRIEF-edit-in-place.md.

(function () {
  'use strict';

  var LF_TYPES = ['Boat','Shore','Drift','Night','Cave','Wreck','Reef','Wall','Pinnacle','Muck'];
  var LF_DEFAULT_CENTER = [-2.0, 118.0]; // Indonesia-ish — only until a pin is set
  var LF_DESKTOP = 1024;                 // matches the CSS two-column breakpoint
  var _lfRailCtx = null;                 // 'location' | 'marine' (form rail only)
  var _maps = {};                        // prefix → { map, marker, geoTimer, geoPending, tried, manualOnly }
  function _ms(p) { return _maps[p] || (_maps[p] = { map: null, marker: null, geoTimer: null, geoPending: null, tried: false, manualOnly: false }); }

  // ── tiny helpers ──
  function _set(id, v) { var el = document.getElementById(id); if (el) el.value = v; }
  function _get(id) { var el = document.getElementById(id); return el ? el.value : ''; }
  function _sum(id) { if (id && typeof _updateSectionSummary === 'function') _updateSectionSummary(id); }
  function _diveSum(p) { return 'cs-dive'; }
  function _condSum(p) { return 'cs-conditions'; }

  // ── dive-type colour-chip grid → hidden {p}-entry ──
  function lfBuildTypeGrid(p) {
    var grid = document.getElementById(p + '-typegrid'); if (!grid) return;
    var cur = _get(p + '-entry');
    // Texture channel: only the SELECTED chip is a full-colour swatch (the
    // unselected ones just carry a thin --tc left-border stripe, not
    // meaningful to texture) — so this only ever reads the secondary
    // ("Also on labelled tags") toggle, never the primary. See the
    // "Dive-type texture channel" CSS block, css/styles.css.
    var texLblOn = typeof _texLabelsOn === 'function' && _texLabelsOn();
    grid.innerHTML = '';
    LF_TYPES.forEach(function (name) {
      var b = document.createElement('button');
      b.type = 'button';
      var sel = cur === name;
      var texThis = sel && texLblOn;
      b.className = 'lf-type-chip' + (sel ? ' sel' : '') + (texThis ? ' tex-halo' : '');
      b.style.setProperty('--tc', 'var(--type-' + name + ')');
      if (texThis && TYPE_TEXTURE[name]) b.setAttribute('data-tex', TYPE_TEXTURE[name]);
      b.textContent = name;
      // Selection state for assistive tech. aria-pressed (toggle) rather than
      // radio semantics: these chips are individually clearable (tap again to
      // clear, below), which is a toggle, not a radio group — and radio would
      // also oblige a roving-tabindex arrow-key model this doesn't implement.
      b.setAttribute('aria-pressed', sel ? 'true' : 'false');
      b.addEventListener('click', function () {
        _set(p + '-entry', cur === name ? '' : name); // tap again to clear
        if (p === 'f' && typeof hideAutoAnnot === 'function') hideAutoAnnot('divetype-auto-label');
        lfBuildTypeGrid(p);
        _sum(_diveSum(p));
      });
      grid.appendChild(b);
    });
  }

  // ── segmented toggles (water type / current / tank type) → hidden input ──
  function lfWireSegments(root) {
    (root || document).querySelectorAll('.lf-seg').forEach(function (seg) {
      if (seg._lfWired) return; seg._lfWired = true;
      var target = seg.getAttribute('data-lf-target');
      var sumId  = seg.getAttribute('data-lf-sum') || '';
      seg.querySelectorAll('.lf-seg-opt').forEach(function (opt) {
        opt.addEventListener('click', function () {
          _set(target, opt.getAttribute('data-val'));
          lfPaintSeg(seg);
          _sum(sumId);
        });
      });
    });
  }
  function lfPaintSeg(seg) {
    var cur = _get(seg.getAttribute('data-lf-target'));
    seg.querySelectorAll('.lf-seg-opt').forEach(function (opt) {
      var on = opt.getAttribute('data-val') === cur;
      opt.classList.toggle('sel', on);
      opt.setAttribute('aria-pressed', on ? 'true' : 'false'); // see lfBuildTypeGrid
    });
  }
  function lfPaintSegs(root) { (root || document).querySelectorAll('.lf-seg').forEach(lfPaintSeg); }

  // ── weather icon row → hidden {p}-weather ──
  function lfWireWeather(p) {
    var wrap = document.getElementById(p + '-weather-seg'); if (!wrap) return;
    wrap.querySelectorAll('.lf-wopt').forEach(function (opt) {
      opt.addEventListener('click', function () {
        var v = opt.getAttribute('data-val');
        _set(p + '-weather', _get(p + '-weather') === v ? '' : v); // tap again to clear
        lfPaintWeather(p);
      });
    });
  }
  function lfPaintWeather(p) {
    var wrap = document.getElementById(p + '-weather-seg'); if (!wrap) return;
    var cur = _get(p + '-weather');
    wrap.querySelectorAll('.lf-wopt').forEach(function (opt) {
      var on = opt.getAttribute('data-val') === cur;
      opt.classList.toggle('sel', on);
      opt.setAttribute('aria-pressed', on ? 'true' : 'false'); // see lfBuildTypeGrid
    });
  }

  // ── vis / temp dials (range slider ↔ number input) ──
  function _dialPairs(p) { return [[p + '-vis-dial', p + '-vis'], [p + '-temp-dial', p + '-temp']]; }
  function lfWireDials(p) {
    _dialPairs(p).forEach(function (pair) {
      var dial = document.getElementById(pair[0]), num = document.getElementById(pair[1]);
      if (!dial || !num) return;
      dial.addEventListener('input', function () { num.value = dial.value; _sum(_condSum(p)); });
      num.addEventListener('input', function () {
        var lo = +dial.min || 0, hi = +dial.max || 35, v = +num.value;
        if (num.value !== '' && !isNaN(v)) dial.value = Math.max(lo, Math.min(hi, v));
        _sum(_condSum(p));
      });
    });
  }
  function lfSyncDials(p) {
    _dialPairs(p).forEach(function (pair) {
      var dial = document.getElementById(pair[0]), num = document.getElementById(pair[1]);
      if (dial && num && num.value !== '') dial.value = num.value;
    });
  }

  // ── Date/Entry/Exit time — custom trigger + native showPicker() ──
  // Full design story is in css/styles.css's comment above .lf-picker-wrap
  // — short version: a background-image icon painted directly on the
  // native <input type="date">/type="time"> was tried first and found
  // broken on two different rendering engines (WKWebView AND Chromium both
  // paint several independently-chromed internal segments, not one flat
  // box, so one icon repeated once per segment). This version sidesteps
  // native date/time rendering entirely — the VISIBLE control is a plain
  // <button> this file fully owns, calling the real (visually hidden on
  // coarse pointers) input's own .showPicker() to do the actual picking.
  // The real input stays the single source of truth for .value; nothing
  // that reads/writes f-date, f-entrytime, or f-exittime elsewhere in the
  // app (saveDive, calcExitTime, UDDF prefill, edit-mode openEdit) changed
  // at all.
  var LF_PICKER_LABELS = { 'f-date': 'Date', 'f-entrytime': 'Entry time', 'f-exittime': 'Exit time' };
  function _lfIsCoarsePointer() {
    return !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
  }
  function _lfFmtPickerValue(id, raw) {
    // Empty state: an em-dash for the two time fields, which sit in a tight
    // 3-column row (Total/Entry/Exit) where each explicit "Entry"/"Exit"
    // label already carries the meaning a longer "Select time" would — the
    // pill shape + clock icon carry the tappable affordance on their own.
    // Date keeps the wordier prompt: it's in a roomy 2-column row, and it's
    // the very first control on the form, where an explicit invitation is
    // worth the width.
    if (!raw) return id === 'f-date' ? 'Select date' : '—';
    if (id === 'f-date') {
      // Appending T00:00:00 (not relying on the bare YYYY-MM-DD parse,
      // which Date() treats as UTC midnight) keeps this reading local
      // calendar fields consistently regardless of the browser's own
      // timezone — there's no time-of-day meaning to a dive DATE, so the
      // usual UTC-vs-local pitfall doesn't apply, but parsing it the same
      // explicit way everywhere avoids relying on which convention a given
      // engine happens to pick for the bare-date form.
      var d = new Date(raw + 'T00:00:00');
      return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    }
    return raw; // f-entrytime/f-exittime values are already a clean HH:MM
  }
  // Called on the real input's own oninput (native picker interaction)
  // AND from lfInitPickerInputs() (covers every OTHER way the value can
  // change — programmatic prefill from UDDF import, edit-mode openEdit —
  // by re-syncing fresh every time the Log panel is shown, the same
  // pattern the Dive # live-placeholder fix uses, rather than needing to
  // hook every individual call site that sets .value directly).
  function lfSyncPickerDisplay(id) {
    var input   = document.getElementById(id);
    var txt     = document.getElementById(id + '-txt');
    var trigger = document.getElementById(id + '-trigger');
    if (!input || !txt || !trigger) return;
    var display = _lfFmtPickerValue(id, input.value);
    txt.textContent = display;
    // An explicit aria-label (not just the <label for> association) so the
    // CURRENT VALUE is always part of what's announced, not just the field
    // name — aria-label takes precedence over label-for in the accessible
    // name computation, so this is the one place that has to carry both.
    trigger.setAttribute('aria-label', (LF_PICKER_LABELS[id] || '') + ': ' + display);
  }
  function lfShowPicker(id) {
    var input = document.getElementById(id);
    if (!input) return;
    try { input.showPicker(); }
    catch (e) { input.focus(); } // showPicker() unsupported/blocked — best-effort fallback
  }
  // Called from the unified show() patch (js/app.js) whenever the Log panel
  // is entered. tabindex/aria-hidden on the real input are set HERE, not as
  // static HTML, because the same input must stay the primary tabbable
  // control on fine-pointer devices (where the trigger button is hidden by
  // CSS and never shown) — this is the one JS/CSS pair in this file that
  // has to agree on which pointer type it's looking at, so both read the
  // same matchMedia query rather than one guessing from the other.
  function lfInitPickerInputs() {
    var coarse = _lfIsCoarsePointer();
    ['f-date', 'f-entrytime', 'f-exittime'].forEach(function (id) {
      var input = document.getElementById(id);
      if (!input) return;
      input.tabIndex = coarse ? -1 : 0;
      if (coarse) input.setAttribute('aria-hidden', 'true');
      else input.removeAttribute('aria-hidden');
      lfSyncPickerDisplay(id);
    });
  }

  // ── Tap-to-scroll number picker (cylinder pressures) ──
  // Typing a start pressure is fiddly for a value that's almost always ~200
  // and an end that's almost always ~50 — the job is fine-tuning around a
  // known figure, not free entry, so a scroll-to-value wheel beats a keypad.
  // Deliberately NOT applied to max/average depth: those are precise,
  // arbitrary readings off a computer, where hunting for an exact number in
  // a wheel is slower than typing it.
  //
  // ADDITIVE, never a replacement: the number input stays fully typeable on
  // every device (precise entry, keyboard users, desktop), and this is a
  // separate trailing button beside it. That's why there's no pointer-type
  // gate here, unlike the date/time pickers above — nothing is taken away,
  // so there's no "can't type on this device" problem to solve.
  //
  // The wheel NEVER writes a value on its own. Opening it on an empty field
  // centres the typical figure purely as a starting point; only an explicit
  // "Set" commits. Cancel, Escape, the back gesture, and a backdrop tap all
  // leave the field exactly as it was — an untouched field stays empty, so
  // an unrecorded pressure is never silently invented as 200/50.
  var LF_SCROLLERS = {
    'f-pstart':   { title: 'Start pressure', unit: 'bar', min: 0, max: 300, step: 5,   typical: 200 },
    'f-pend':     { title: 'End pressure',   unit: 'bar', min: 0, max: 300, step: 5,   typical: 50  },
    'f-weight':   { title: 'Weight',         unit: 'kg',  min: 0, max: 20,  step: 0.5, typical: 6   },
    'f-tanksize': { title: 'Tank size',      unit: 'L',   min: 3, max: 18,  step: 0.5, typical: 12  },
  };
  var LF_SCROLL_ITEM_H = 44;   // must match .numscroll-item height in CSS
  var LF_SCROLL_VISIBLE = 5;   // odd, so one row sits dead centre
  var _numScroll = null;       // { inputId, values, trackEl, idx }

  // Built by index, not by accumulating `v += step`: a fractional step (kg
  // weight uses 0.5) drifts under repeated float addition, which would put
  // 6.000000000000001 in the list and then into the saved dive. Multiplying
  // once per item and rounding to 2dp keeps every value exact.
  function _numScrollValues(cfg) {
    var out = [], n = Math.round((cfg.max - cfg.min) / cfg.step);
    for (var i = 0; i <= n; i++) out.push(Math.round((cfg.min + i * cfg.step) * 100) / 100);
    return out;
  }
  function _numScrollSetCentre(idx, scroll) {
    if (!_numScroll) return;
    var n = _numScroll.values.length;
    idx = Math.max(0, Math.min(n - 1, idx));
    _numScroll.idx = idx;
    var items = _numScroll.trackEl.querySelectorAll('.numscroll-item');
    for (var i = 0; i < items.length; i++) {
      var on = i === idx;
      items[i].classList.toggle('is-centre', on);
      items[i].setAttribute('aria-selected', on ? 'true' : 'false');
    }
    _numScroll.trackEl.setAttribute('aria-activedescendant', 'numscroll-opt-' + idx);
    if (scroll) _numScroll.trackEl.scrollTo({ top: idx * LF_SCROLL_ITEM_H, behavior: 'smooth' });
  }
  function lfOpenNumScroller(inputId) {
    var cfg = LF_SCROLLERS[inputId];
    var input = document.getElementById(inputId);
    if (!cfg || !input || _numScroll) return;

    var values = _numScrollValues(cfg);
    // Seed from the field's OWN value when it has one (so re-opening starts
    // where you left it, snapped to the nearest step), otherwise the typical
    // figure — which is a starting position only, never a committed value.
    var seed = input.value !== '' && !isNaN(+input.value) ? +input.value : cfg.typical;
    var idx  = Math.round((Math.max(cfg.min, Math.min(cfg.max, seed)) - cfg.min) / cfg.step);

    var pad = (LF_SCROLL_ITEM_H * LF_SCROLL_VISIBLE - LF_SCROLL_ITEM_H) / 2;
    var itemsHtml = values.map(function (v, i) {
      return '<div class="numscroll-item" role="option" id="numscroll-opt-' + i + '"'
           + ' aria-selected="false" data-i="' + i + '">' + v + '</div>';
    }).join('');

    var wrap = document.createElement('div');
    wrap.id = 'numscroll-overlay';
    wrap.className = 'numscroll-overlay';
    wrap.innerHTML =
      '<div class="numscroll-sheet" role="dialog" aria-modal="true" aria-labelledby="numscroll-title">'
      + '<div class="numscroll-head"><span class="numscroll-title" id="numscroll-title"></span>'
      + '<span class="numscroll-unit"></span></div>'
      + '<div class="numscroll-viewport">'
      + '<div class="numscroll-band" aria-hidden="true"></div>'
      + '<div class="numscroll-track" id="numscroll-track" role="listbox" tabindex="0"'
      + ' aria-labelledby="numscroll-title">'
      + '<div class="numscroll-pad" style="height:' + pad + 'px"></div>'
      + itemsHtml
      + '<div class="numscroll-pad" style="height:' + pad + 'px"></div>'
      + '</div></div>'
      + '<div class="numscroll-acts">'
      + '<button type="button" class="btn-ghost numscroll-cancel">Cancel</button>'
      + '<button type="button" class="numscroll-set">Set</button>'
      + '</div></div>';

    // textContent, never innerHTML, for anything that isn't a fixed literal.
    wrap.querySelector('.numscroll-title').textContent = cfg.title;
    wrap.querySelector('.numscroll-unit').textContent  = cfg.unit;

    wrap._prevFocus = document.activeElement;
    document.body.appendChild(wrap);

    var track = wrap.querySelector('.numscroll-track');
    _numScroll = { inputId: inputId, values: values, trackEl: track, idx: idx };

    // Jump (not smooth) to the seed position before the sheet is interactive,
    // so it opens already centred rather than visibly animating into place.
    track.scrollTop = idx * LF_SCROLL_ITEM_H;
    _numScrollSetCentre(idx, false);

    var settleTimer = null;
    track.addEventListener('scroll', function () {
      clearTimeout(settleTimer);
      settleTimer = setTimeout(function () {
        if (!_numScroll) return;
        _numScrollSetCentre(Math.round(track.scrollTop / LF_SCROLL_ITEM_H), false);
      }, 60);
    });
    track.addEventListener('keydown', function (e) {
      var d = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1
            : e.key === 'PageDown' ? 5 : e.key === 'PageUp' ? -5 : 0;
      if (d) { e.preventDefault(); _numScrollSetCentre(_numScroll.idx + d, true); return; }
      if (e.key === 'Home') { e.preventDefault(); _numScrollSetCentre(0, true); return; }
      if (e.key === 'End')  { e.preventDefault(); _numScrollSetCentre(_numScroll.values.length - 1, true); return; }
      if (e.key === 'Enter') { e.preventDefault(); lfNumScrollerCommit(); }
    });
    track.addEventListener('click', function (e) {
      var item = e.target.closest ? e.target.closest('.numscroll-item') : null;
      if (item) _numScrollSetCentre(+item.dataset.i, true);
    });

    wrap.querySelector('.numscroll-set').addEventListener('click', lfNumScrollerCommit);
    wrap.querySelector('.numscroll-cancel').addEventListener('click', function () { closeTopOverlay(); });
    wrap.addEventListener('click', function (e) { if (e.target === wrap) closeTopOverlay(); });

    if (typeof _lockScroll === 'function') _lockScroll();
    if (typeof _pushOverlayState === 'function') _pushOverlayState({ type: 'numScroller' });
    track.focus();
  }
  // Commit writes the value FIRST, then closes — closeTopOverlay() runs the
  // popstate teardown, which clears _numScroll.
  function lfNumScrollerCommit() {
    if (!_numScroll) return;
    var input = document.getElementById(_numScroll.inputId);
    if (input) {
      input.value = String(_numScroll.values[_numScroll.idx]);
      // A real input event, so this is indistinguishable from typing to any
      // listener (section-summary chips, autocomplete, anything added later)
      // rather than needing each one hand-called from here.
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    closeTopOverlay();
  }
  // DOM teardown. Called ONLY from app.js's _closeOverlayDirect via the
  // popstate handler, matching every other overlay type.
  function closeNumScrollerDirect() {
    var wrap = document.getElementById('numscroll-overlay');
    if (wrap) {
      if (wrap._prevFocus && wrap._prevFocus.focus) { try { wrap._prevFocus.focus(); } catch (e) {} }
      wrap.remove();
    }
    _numScroll = null;
    if (typeof _unlockScroll === 'function') _unlockScroll();
  }

  // ── in-form / in-modal location map (Leaflet pin) ──
  function lfOnSectionOpen(id) {
    if (id === 'cs-dive') lfEnsureMap('f');
    if (id.indexOf('cs-') === 0 && window.innerWidth >= LF_DESKTOP) {
      lfSetRailContext(id === 'cs-marine' ? 'marine' : 'location');
    }
  }

  function lfEnsureMap(p) {
    var st = _ms(p);
    if (st.map) { setTimeout(function () { st.map.invalidateSize(); }, 60); return; }
    if (st.tried) return;
    st.tried = true;
    if (typeof loadLeaflet !== 'function') { lfShowOffline(p); return; }
    loadLeaflet().then(function () {
      var el = document.getElementById(p + '-map');
      if (!el || typeof L === 'undefined') { lfShowOffline(p); return; }
      var lat = parseFloat(_get(p + '-gps-lat')), lng = parseFloat(_get(p + '-gps-lng'));
      var has = !isNaN(lat) && !isNaN(lng);
      var center = has ? [lat, lng] : LF_DEFAULT_CENTER;
      st.map = L.map(p + '-map', { center: center, zoom: has ? 11 : 4, zoomControl: true, scrollWheelZoom: false });
      var tiles = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>', maxZoom: 18
      });
      var failed = 0;
      tiles.on('tileerror', function () { if (++failed > 5) lfShowOffline(p); });
      tiles.addTo(st.map);
      st.marker = L.marker(center, { draggable: true }).addTo(st.map);
      st.marker.on('dragend', function () { lfOnPin(p, false); });
      // Compact-preview vs full-screen behaviour share one handler each,
      // branching on st.compactMode at call time — see lfOpenMapPicker /
      // closeMapPickerDirect, which flip the flag and the underlying
      // Leaflet handlers together whenever the map changes context.
      st.marker.on('click', function () { if (st.compactMode) lfOpenMapPicker(p); });
      st.map.on('click', function (e) {
        if (st.compactMode) { lfOpenMapPicker(p); return; }
        st.marker.setLatLng(e.latlng); lfOnPin(p, false);
      });
      setTimeout(function () { st.map.invalidateSize(); }, 120);
      if (has) lfOnPin(p, true); // refresh readout only; don't geocode a restored pin
      // Mobile starts as a non-interactive preview — a glance, not a picker.
      // Desktop (the rail already gives it room) stays fully interactive.
      st.compactMode = (p === 'f' && window.innerWidth < LF_DESKTOP);
      if (st.compactMode) _lfSetMapInteractive(p, false);
    }).catch(function () { lfShowOffline(p); });
  }

  // Toggles the map's own drag/zoom handlers and the marker's drag handler
  // together — the compact preview (mobile, map inline) and the full-screen
  // picker (mobile, map in #f-map-modal) are the SAME Leaflet instance, just
  // with interaction on or off. Desktop never calls this; it's always on.
  function _lfSetMapInteractive(p, on) {
    var st = _ms(p);
    if (!st.map) return;
    var fn = on ? 'enable' : 'disable';
    st.map.dragging[fn]();
    if (st.map.doubleClickZoom) st.map.doubleClickZoom[fn]();
    if (st.map.touchZoom) st.map.touchZoom[fn]();
    if (st.map.boxZoom) st.map.boxZoom[fn]();
    if (st.marker && st.marker.dragging) st.marker.dragging[fn]();
  }

  function lfOnPin(p, skipGeo) {
    var st = _ms(p); if (!st.marker) return;
    var ll = st.marker.getLatLng();
    _set(p + '-gps-lat', ll.lat.toFixed(6));
    _set(p + '-gps-lng', ll.lng.toFixed(6));
    var rd = document.getElementById(p + '-coord');
    if (rd) rd.textContent = ll.lat.toFixed(4) + ', ' + ll.lng.toFixed(4);
    if (skipGeo) return;
    clearTimeout(st.geoTimer);
    var row = document.getElementById(p + '-geo-row'); if (row) row.style.display = 'flex';
    var sub = document.getElementById(p + '-geo-sub'); if (sub) sub.textContent = 'Looking up place…';
    var btn = document.getElementById(p + '-geo-confirm');
    if (btn) { btn.textContent = 'Confirm'; btn.disabled = false; btn.classList.remove('done'); }
    st.geoTimer = setTimeout(function () { lfReverseGeocode(p, ll.lat, ll.lng); }, 700);
  }

  function lfReverseGeocode(p, lat, lng) {
    var st = _ms(p);
    fetch('https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=' + lat + '&lon=' + lng + '&zoom=8',
          { headers: { 'Accept': 'application/json' } })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        var a = j.address || {};
        var region  = a.state || a.county || a.region || a.island || a.city || '';
        var country = a.country || '';
        st.geoPending = { region: region, country: country };
        var place = document.getElementById(p + '-geo-place');
        var sub   = document.getElementById(p + '-geo-sub');
        if (place) place.textContent = [region, country].filter(Boolean).join(' · ') || 'Open water';
        if (sub)   sub.textContent   = 'From the pin — tap to confirm';
      })
      .catch(function () {
        st.geoPending = null;
        var sub = document.getElementById(p + '-geo-sub');
        if (sub) sub.textContent = 'Place lookup unavailable — confirm or skip';
      });
  }

  function lfWireGeoConfirm(p) {
    var btn = document.getElementById(p + '-geo-confirm'); if (!btn) return;
    btn.addEventListener('click', function () {
      var st = _ms(p);
      if (st.geoPending) {
        _set(p + '-location', st.geoPending.country || '');
        _set(p + '-region',   st.geoPending.region  || '');
        lfCountryChange(p); // _set() only assigns .value — no change event, so
                             // the species region filter needs an explicit kick
      }
      btn.textContent = '✓ Saved'; btn.classList.add('done'); btn.disabled = true;
      var sub = document.getElementById(p + '-geo-sub'); if (sub) sub.textContent = 'Saved to Country / Region';
      _sum(_diveSum(p));
      // Confirming the place is the natural "I'm done" signal for the
      // full-screen picker — auto-return to the form instead of making
      // Done a second required tap. A brief pause lets "✓ Saved" register
      // before the view changes. Desktop/inline confirm (no modal open)
      // is unaffected.
      var modal = document.getElementById('f-map-modal');
      if (modal && modal.classList.contains('open')) {
        setTimeout(function () { closeMapPicker(); }, 500);
      }
    });
  }

  function lfUseMyLocation(p) {
    var st = _ms(p);
    var btn = document.getElementById(p + '-useloc');
    if (!navigator.geolocation) { lfShowOffline(p); return; }
    if (btn) btn.textContent = '… locating';
    navigator.geolocation.getCurrentPosition(
      function (pos) {
        var la = pos.coords.latitude, lo = pos.coords.longitude;
        _set(p + '-gps-lat', la.toFixed(6));
        _set(p + '-gps-lng', lo.toFixed(6));
        if (st.map && st.marker) { st.marker.setLatLng([la, lo]); st.map.setView([la, lo], 12); lfOnPin(p, false); }
        else { var rd = document.getElementById(p + '-coord'); if (rd) rd.textContent = la.toFixed(4) + ', ' + lo.toFixed(4); }
        if (btn) btn.textContent = '⊕ Use my location';
      },
      function () {
        if (btn) btn.textContent = '⊕ Use my location';
        var stt = document.getElementById(p + '-gps-status');
        if (stt) stt.textContent = 'Location unavailable — drop the pin manually.';
      },
      { enableHighAccuracy: true, timeout: 15000 }
    );
  }

  function lfShowOffline(p) {
    _ms(p).manualOnly = false; // hard fail — distinct from the optional manual toggle below
    var off = document.getElementById(p + '-map-offline');
    if (off) { off.style.display = 'block'; off.classList.remove('neutral'); }
    var wrap = document.getElementById(p + '-map-wrap');   if (wrap) wrap.style.display = 'none';
    var msg = document.getElementById(p + '-offline-msg');
    if (msg) { msg.textContent = '⚠ Map unavailable offline — enter coordinates manually'; msg.classList.remove('neutral'); }
  }

  // ── Manual coordinate entry (v2.84) — an opt-in way to type exact
  // coordinates while the map stays live, distinct from lfShowOffline's hard
  // fail (which hides the map entirely). Reveals the SAME {p}-gps-lat/lng
  // inputs the offline fallback uses; lfOnPin/lfSetPin already keep them in
  // sync with the pin, so opening this always shows the current pin's
  // coordinates if one exists — covers both "type exact coords from
  // scratch" and "tweak a roughly-dropped pin using precise numbers".
  function lfToggleManualCoords(p) {
    var off = document.getElementById(p + '-map-offline'); if (!off) return;
    var willOpen = off.style.display === 'none' || !off.style.display;
    off.style.display = willOpen ? 'block' : 'none';
    off.classList.toggle('neutral', willOpen);
    _ms(p).manualOnly = willOpen;
    var msg = document.getElementById(p + '-offline-msg');
    if (msg) { msg.textContent = 'Enter coordinates manually'; msg.classList.toggle('neutral', willOpen); }
    var btn = document.getElementById(p + '-manual-toggle');
    if (btn) btn.textContent = willOpen ? '✕ Hide' : '✎ Enter coordinates';
    var stt = document.getElementById(p + '-gps-status'); if (stt) stt.textContent = '';
  }

  function lfApplyManualCoords(p) {
    var lat = parseFloat(_get(p + '-gps-lat')), lng = parseFloat(_get(p + '-gps-lng'));
    var stt = document.getElementById(p + '-gps-status');
    if (isNaN(lat) || isNaN(lng)) {
      if (stt) stt.textContent = 'Enter both latitude and longitude.';
      return;
    }
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      if (stt) stt.textContent = 'Latitude must be -90..90, longitude -180..180.';
      return;
    }
    lfSetPin(p, lat, lng, true);
    if (stt) stt.textContent = '✓ Pin set';
  }

  function lfWireManualCoords(p) {
    [p + '-gps-lat', p + '-gps-lng'].forEach(function (id) {
      var el = document.getElementById(id); if (!el) return;
      el.addEventListener('input', function () {
        var rd = document.getElementById(p + '-coord');
        if (rd) rd.textContent = (_get(p + '-gps-lat') || '—') + ', ' + (_get(p + '-gps-lng') || '—');
      });
    });
  }

  // External pin set (picking a Dive Vibe / OSM site) — moves marker, repaints
  // the chip grid (dive type may have been auto-filled), optional geocode.
  function lfSetPin(p, lat, lng, geocode) {
    if (isNaN(lat) || isNaN(lng)) return;
    var st = _ms(p);
    _set(p + '-gps-lat', lat.toFixed(6));
    _set(p + '-gps-lng', lng.toFixed(6));
    var rd = document.getElementById(p + '-coord');
    if (rd) rd.textContent = lat.toFixed(4) + ', ' + lng.toFixed(4);
    lfBuildTypeGrid(p);
    if (st.map && st.marker) { st.marker.setLatLng([lat, lng]); st.map.setView([lat, lng], 12); }
    if (geocode) {
      var row = document.getElementById(p + '-geo-row'); if (row) row.style.display = 'flex';
      var sub = document.getElementById(p + '-geo-sub'); if (sub) sub.textContent = 'Looking up place…';
      var btn = document.getElementById(p + '-geo-confirm');
      if (btn) { btn.textContent = 'Confirm'; btn.disabled = false; btn.classList.remove('done'); }
      clearTimeout(st.geoTimer);
      st.geoTimer = setTimeout(function () { lfReverseGeocode(p, lat, lng); }, 700);
    }
  }

  // Country select → focus the map on that country (two-way with reverse-geocode)
  function lfCountryChange(p) {
    p = p || 'f';
    _sum(_diveSum(p));
    if (typeof prefetchSearchBbox === 'function') prefetchSearchBbox(p); // site-search bias
    lfFocusCountry(p, _get(p + '-location'));
    if (typeof updateSpeciesRegionFilter === 'function') updateSpeciesRegionFilter(_get(p + '-location'));
  }
  function lfFocusCountry(p, country) {
    var st = _ms(p);
    if (!country || !st.map) return;
    fetch('https://nominatim.openstreetmap.org/search?country=' + encodeURIComponent(country) + '&format=json&limit=1',
          { headers: { 'Accept-Language': 'en' } })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d.length || !st.map) return;
        var bb = d[0].boundingbox; // [south, north, west, east]
        if (bb) st.map.fitBounds([[+bb[0], +bb[2]], [+bb[1], +bb[3]]]);
      })
      .catch(function () {});
  }

  function lfDestroyMap(p) {
    var st = _ms(p);
    if (st.map) { try { st.map.remove(); } catch (e) {} }
    _maps[p] = { map: null, marker: null, geoTimer: null, geoPending: null, tried: false };
  }

  // ── full-screen map picker (mobile only) ──────────────────────────────────
  // The compact map keeps today's exact behaviour (tap-to-place, drag-to-
  // adjust) — this only gives the SAME live instance more room when that's
  // too cramped to navigate, by reparenting #f-mapbox into a full-viewport
  // overlay, the same DOM-relocation trick the desktop rail already uses
  // (see lfSetRailContext below). No second Leaflet instance, no change to
  // any pin/geocode logic — it all just keeps working wherever the node is.
  // Wired into the standard overlay-stack (app.js) so back-gesture/Escape
  // close it exactly like the dive file, species profile, and footage modal.
  function lfMapModalEl() {
    var ov = document.getElementById('f-map-modal');
    if (!ov) {
      ov = document.createElement('div');
      ov.id = 'f-map-modal';
      ov.className = 'map-modal';
      ov.innerHTML =
        '<div class="map-modal-head">' +
          '<span class="map-modal-title">Set location</span>' +
          '<button type="button" class="map-modal-close" onclick="closeMapPicker()">✕</button>' +
        '</div>' +
        '<div class="map-modal-body" id="f-mapmodal-body"></div>';
      document.body.appendChild(ov);
    }
    return ov;
  }
  function lfOpenMapPicker(p) {
    if (window.innerWidth >= LF_DESKTOP) return; // desktop rail already has room
    var ov = lfMapModalEl();
    var body = document.getElementById('f-mapmodal-body');
    var mapbox = document.getElementById(p + '-mapbox');
    if (mapbox && body && mapbox.parentNode !== body) { body.appendChild(mapbox); mapbox.classList.add('in-modal'); }
    ov.classList.add('open');
    if (typeof _pushOverlayState === 'function') _pushOverlayState({ type: 'mapPicker', prefix: p });
    if (typeof _lockScroll === 'function') _lockScroll();
    var st = _ms(p);
    st.compactMode = false;
    _lfSetMapInteractive(p, true);
    if (st.map) setTimeout(function () { st.map.invalidateSize(); }, 80);
  }
  function closeMapPicker() {
    if (typeof closeTopOverlay === 'function') closeTopOverlay();
  }
  // Called only from the popstate handler (app.js _closeOverlayDirect) — mirrors
  // closeDiveFileDirect/closeSpeciesProfileDirect/closeFootageDirect exactly.
  function closeMapPickerDirect() {
    var ov = document.getElementById('f-map-modal');
    if (ov) ov.classList.remove('open');
    var slot = document.getElementById('f-map-slot');
    var mapbox = document.getElementById('f-mapbox');
    if (slot && mapbox && mapbox.parentNode !== slot) { slot.appendChild(mapbox); mapbox.classList.remove('in-modal'); }
    if (typeof _unlockScroll === 'function') _unlockScroll();
    var st = _ms('f');
    st.compactMode = window.innerWidth < LF_DESKTOP;
    if (st.compactMode) _lfSetMapInteractive('f', false);
    if (st.map) setTimeout(function () { st.map.invalidateSize(); }, 80);
  }

  // ── desktop two-column rail (FORM only): map (location) ⇄ species (marine) ──
  function lfHolder() {
    var h = document.getElementById('lf-holder');
    if (!h) {
      h = document.createElement('div');
      h.id = 'lf-holder'; h.style.display = 'none';
      (document.getElementById('panel-log') || document.body).appendChild(h);
    }
    return h;
  }
  function lfLayout() {
    var panel = document.getElementById('panel-log'); if (!panel) return;
    var mapModal = document.getElementById('f-map-modal');
    if (mapModal && mapModal.classList.contains('open')) return; // picker owns #f-mapbox while open
    var desktop = window.innerWidth >= LF_DESKTOP;
    panel.classList.toggle('lf-desktop', desktop);
    var fm = _ms('f');
    if (desktop) {
      lfSetRailContext(_lfRailCtx || 'location');
    } else {
      var slot = document.getElementById('f-map-slot');
      var mapbox = document.getElementById('f-mapbox');
      if (slot && mapbox && mapbox.parentNode !== slot) { slot.appendChild(mapbox); mapbox.classList.remove('in-rail'); }
      if (slot) slot.style.display = '';
      var ssw = document.getElementById('species-search-wrap');
      var dd = document.getElementById('species-dropdown');
      if (ssw && dd && dd.parentNode !== ssw) { ssw.appendChild(dd); dd.style.display = 'none'; }
      if (fm.map) setTimeout(function () { fm.map.invalidateSize(); }, 60);
    }
  }
  function lfSetRailContext(ctx) {
    _lfRailCtx = ctx;
    if (window.innerWidth < LF_DESKTOP) return;
    var body = document.getElementById('log-rail-body');
    var head = document.getElementById('log-rail-head');
    if (!body) return;
    var holder = lfHolder();
    var slot = document.getElementById('f-map-slot');
    if (slot) slot.style.display = 'none'; // map lives in the rail on desktop
    var mapbox = document.getElementById('f-mapbox');
    var dd = document.getElementById('species-dropdown');
    var fm = _ms('f');
    if (ctx === 'marine') {
      if (head) head.textContent = 'Marine life';
      if (mapbox && mapbox.parentNode !== holder) { holder.appendChild(mapbox); mapbox.classList.remove('in-rail'); }
      body.className = 'lf-rail-body ctx-marine';
      if (dd) body.appendChild(dd);
      if (typeof _renderFormPanel === 'function') {
        var mi = document.getElementById('marine-input');
        _renderFormPanel(mi ? mi.value.trim() : '');
      }
    } else {
      if (head) head.textContent = 'Location';
      if (dd && dd.parentNode !== holder) { holder.appendChild(dd); dd.style.display = 'none'; }
      body.className = 'lf-rail-body ctx-location';
      if (mapbox) { body.appendChild(mapbox); mapbox.classList.add('in-rail'); }
      if (fm.map) setTimeout(function () { fm.map.invalidateSize(); }, 60);
    }
  }
  function lfEnsureMarineRail() {
    if (window.innerWidth >= LF_DESKTOP && _lfRailCtx !== 'marine') lfSetRailContext('marine');
  }

  // Repaint every form control from the canonical inputs (after reset / on load)
  function lfSyncFromFields() {
    var p = 'f';
    lfBuildTypeGrid(p);
    lfPaintSegs(document.getElementById('panel-log'));
    lfPaintWeather(p);
    lfSyncDials(p);
    var st = _ms(p);
    var la = _get('f-gps-lat'), lo = _get('f-gps-lng'), has = la !== '' && lo !== '';
    var rd = document.getElementById('f-coord');
    if (rd) rd.textContent = has ? (parseFloat(la).toFixed(4) + ', ' + parseFloat(lo).toFixed(4))
                                 : 'Tap the map or use your location';
    var grow = document.getElementById('f-geo-row'); if (grow && !has) grow.style.display = 'none';
    var gbtn = document.getElementById('f-geo-confirm');
    if (gbtn) { gbtn.textContent = 'Confirm'; gbtn.disabled = false; gbtn.classList.remove('done'); }
    st.geoPending = null;
    if (st.map && st.marker) {
      if (has) { st.marker.setLatLng([parseFloat(la), parseFloat(lo)]); }
      else { st.marker.setLatLng(LF_DEFAULT_CENTER); st.map.setView(LF_DEFAULT_CENTER, 4); }
      setTimeout(function () { st.map.invalidateSize(); }, 60);
    }
    // Close the manual-coordinate panel on every full repaint (new dive /
    // cancelled edit / boot) — but never while genuinely offline (manualOnly
    // is false in that case; lfShowOffline is the one place that sets it).
    if (!st.manualOnly) {
      var off = document.getElementById(p + '-map-offline');
      if (off) { off.style.display = 'none'; off.classList.remove('neutral'); }
      var mbtn = document.getElementById(p + '-manual-toggle');
      if (mbtn) mbtn.textContent = '✎ Enter coordinates';
    }
  }

  // ── init: log form (prefix 'f') ──
  function lfInit() {
    if (!document.getElementById('f-typegrid')) return; // redesigned form not present
    lfBuildTypeGrid('f');
    lfWireSegments(document.getElementById('panel-log'));
    lfWireDials('f');
    lfWireWeather('f');
    lfWireGeoConfirm('f');
    lfWireManualCoords('f');
    var ul = document.getElementById('f-useloc'); if (ul) ul.addEventListener('click', function () { lfUseMyLocation('f'); });
    lfSyncFromFields();
    var dive = document.getElementById('cs-dive');
    if (dive && dive.classList.contains('open')) lfEnsureMap('f');
    lfLayout();
    window.addEventListener('resize', lfLayout);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', lfInit);
  else lfInit();

  // Hooks called from app.js / species.js / inline handlers
  window.lfOnSectionOpen    = lfOnSectionOpen;
  window.lfSyncFromFields   = lfSyncFromFields;
  window.lfSetPin           = lfSetPin;            // (prefix, lat, lng, geocode)
  window.lfCountryChange    = lfCountryChange;     // (prefix='f')
  window.lfEnsureMarineRail = lfEnsureMarineRail;
  window.lfToggleManualCoords = lfToggleManualCoords;
  window.lfApplyManualCoords  = lfApplyManualCoords;
  window.lfOpenMapPicker      = lfOpenMapPicker;
  window.closeMapPicker       = closeMapPicker;
  window.closeMapPickerDirect = closeMapPickerDirect; // called only from app.js _closeOverlayDirect
  window.lfShowPicker         = lfShowPicker;
  window.lfSyncPickerDisplay  = lfSyncPickerDisplay;
  window.lfInitPickerInputs   = lfInitPickerInputs;   // called from app.js's unified show() patch
  window.lfOpenNumScroller       = lfOpenNumScroller;
  window.lfNumScrollerCommit     = lfNumScrollerCommit;
  window.closeNumScrollerDirect  = closeNumScrollerDirect; // called only from app.js _closeOverlayDirect
})();
