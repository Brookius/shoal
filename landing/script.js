// Shoal landing page — vanilla JS, no framework, addEventListener only.
// Three self-contained pieces: the depth/NDL chart, the caustics SVG filter
// (copied from index.html), and the marine-life carousel.
//
// The chart's maths (_hexToRgb/_hexLerp/_ndlColor/_smoothPathD/_niceStep) is
// no longer hand-copied here — it's a genuine shared file (chart-math.js,
// loaded just before this one), regenerated from js/chart-math.js by
// landing/prepare-shared.sh at deploy time. This file only supplies the
// colour SOURCES (below) and the demo-specific rendering around them; the
// app reads its own colours live via getComputedStyle instead, since it has
// an actual theme to read from and this static page doesn't.

(function () {
  'use strict';

  // ── Depth/NDL chart — same shared maths as the real app, different colour
  // source (this static page has no live stylesheet token to read, so these
  // are the literal current values from css/styles.css — keep them in step
  // by eye if that file's --profile-*/--warn/--danger tokens ever change;
  // prepare-shared.sh doesn't currently generate this small a slice).
  const CALM_HEX   = '#89B7D1';
  const WARN_HEX   = '#E0734F'; // --profile-warn, NOT --warn (#9C5621) — the
                                 // chart's own dedicated shade, unconstrained
                                 // by the text-contrast floor --warn carries.
  const DANGER_HEX = '#B0492E';
  const DECO_HEX   = '#6A2C1C';
  const FILL_TOP    = '#C0D8E6';
  const FILL_BOTTOM = '#65A1C3';

  async function renderProfileChart(el) {
    const src = el.getAttribute('data-src');
    let json;
    try {
      const res = await fetch(src);
      json = await res.json();
    } catch (e) { return; } // offline — chart area stays empty, stats above still show

    let waypoints = json.waypoints.map(a => ({ t: a[0], d: a[1], ndl: a[2] }));
    const firstReal = waypoints[0];
    if (firstReal.t > 0 || firstReal.d > 0.3) waypoints = [{ t: 0, d: 0, ndl: null }, ...waypoints];

    const W = 640, H = 300;
    const padL = 34, padR = 34, padT = 14, padB = 26;
    const plotW = W - padL - padR, plotH = H - padT - padB;

    const duration = Math.max(1, waypoints[waypoints.length - 1].t);
    const maxD = waypoints.reduce((m, w) => Math.max(m, w.d), 0);
    const depthStep = _niceStep(maxD, 4);
    const depthCeil = (Math.ceil(maxD / depthStep) * depthStep) || depthStep;
    const timeStepMin = _niceStep(duration / 60, 5);
    const timeCeilMin = (Math.ceil((duration / 60) / timeStepMin) * timeStepMin) || timeStepMin;

    const x = t => padL + (t / duration) * plotW;
    const y = d => padT + (d / depthCeil) * plotH;
    const pctX = px => (px / W * 100).toFixed(2);
    const pctY = py => (py / H * 100).toFixed(2);

    const pts = waypoints.map(w => ({ x: x(w.t), y: y(w.d) }));
    const curveD = _smoothPathD(pts);
    const fillD = `${curveD} L${pts[pts.length - 1].x.toFixed(2)},${padT} L${pts[0].x.toFixed(2)},${padT} Z`;

    const hasNdl = waypoints.some(w => typeof w.ndl === 'number');
    let lastNdl = null;
    const ndlSeries = waypoints.map(w => {
      if (typeof w.ndl === 'number' && w.d > 3) lastNdl = w.ndl;
      return lastNdl;
    });
    let decoStartIdx = hasNdl ? ndlSeries.findIndex(v => typeof v === 'number' && v <= 0) : -1;

    let strokeColor = CALM_HEX, gradientDefs = '';
    const key = 'landing';
    if (hasNdl) {
      const x0 = pts[0].x, xN = pts[pts.length - 1].x, span = (xN - x0) || 1;
      const stops = waypoints.map((w, i) => {
        const off = ((pts[i].x - x0) / span * 100).toFixed(2);
        const locked = decoStartIdx > -1 && i >= decoStartIdx;
        const color = locked ? DECO_HEX : _ndlColor(ndlSeries[i], CALM_HEX, WARN_HEX, DANGER_HEX);
        return `<stop offset="${off}%" stop-color="${color}"/>`;
      }).join('');
      gradientDefs = `<linearGradient id="ndlg-${key}" gradientUnits="userSpaceOnUse" x1="${x0}" y1="0" x2="${xN}" y2="0">${stops}</linearGradient>`;
      strokeColor = `url(#ndlg-${key})`;
    }

    const depthTicks = []; for (let v = 0; v <= depthCeil; v += depthStep) depthTicks.push(v);
    const timeTicksMin = []; for (let v = 0; v <= timeCeilMin; v += timeStepMin) timeTicksMin.push(v);
    const gridLines = depthTicks.map(v => `<line x1="${padL}" y1="${y(v).toFixed(2)}" x2="${W - padR}" y2="${y(v).toFixed(2)}" class="pc-grid"/>`).join('');
    const yLabels = depthTicks.map(v => `<div class="pc-ytick" style="top:${pctY(y(v))}%">${v}${v === 0 ? ' m' : ''}</div>`).join('');
    const xLabels = timeTicksMin.map((v, i) => `<div class="pc-xtick" style="left:${pctX(x(v * 60))}%">${v}${i === timeTicksMin.length - 1 ? ' min' : ''}</div>`).join('');

    const entryPt = pts[0], exitPt = pts[pts.length - 1];
    const maxIdx = waypoints.findIndex(w => w.d === maxD);
    const maxPt = pts[maxIdx];
    const dots = `<circle class="pc-dot" cx="${entryPt.x.toFixed(2)}" cy="${entryPt.y.toFixed(2)}" r="4"/>
      <circle class="pc-dot" cx="${exitPt.x.toFixed(2)}" cy="${exitPt.y.toFixed(2)}" r="4"/>
      <circle class="pc-dot pc-dot-max" cx="${maxPt.x.toFixed(2)}" cy="${maxPt.y.toFixed(2)}" r="3"/>`;
    // Real dive's logged clock times (M2 wreck, 27 Aug 2023) — literal, not
    // derived from a dive object, since this page has no logged dive record.
    const evtLabels = `
      <div class="pc-evt" style="left:${pctX(entryPt.x)}%;top:${pctY(entryPt.y)}%;transform:translate(2px,-18px)">13:25</div>
      <div class="pc-evt pc-evt-r" style="left:${pctX(exitPt.x)}%;top:${pctY(exitPt.y)}%">13:55</div>`;

    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" style="display:block;width:100%;height:100%;overflow:visible">
      <defs>
        <linearGradient id="fillg-${key}" gradientUnits="userSpaceOnUse" x1="0" y1="${padT}" x2="0" y2="${H - padB}">
          <stop offset="0%" stop-color="${FILL_TOP}"/><stop offset="100%" stop-color="${FILL_BOTTOM}"/>
        </linearGradient>
        ${gradientDefs}
      </defs>
      ${gridLines}
      <path d="${fillD}" fill="url(#fillg-${key})" opacity="0.55" stroke="none"/>
      <path d="${curveD}" fill="none" stroke="${strokeColor}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
      ${dots}
    </svg>${yLabels}${xLabels}${evtLabels}`;
  }

  // ── Caustics SVG filter — exact values from index.html's real filter.
  // Reduced-motion gating is a deliberate addition for this page (it has no
  // shimmer-intensity dial of its own to turn speed down) — NOT a literal
  // copy of production behaviour, which has no such gating, only a dial.
  function mountCausticFilter() {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const anim = reduced ? '' :
      '<animate id="caustic-anim" attributeName="baseFrequency" dur="18s" ' +
      'values="0.008 0.006; 0.011 0.009; 0.006 0.008; 0.010 0.005; 0.008 0.006" ' +
      'calcMode="spline" keyTimes="0; 0.25; 0.5; 0.75; 1" ' +
      'keySplines="0.4 0 0.6 1; 0.4 0 0.6 1; 0.4 0 0.6 1; 0.4 0 0.6 1" repeatCount="indefinite"/>';
    const wrap = document.createElement('div');
    wrap.setAttribute('aria-hidden', 'true');
    wrap.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
    wrap.innerHTML =
      '<svg><defs>' +
      '<filter id="caustic-light" color-interpolation-filters="linearRGB">' +
      '<feTurbulence type="fractalNoise" baseFrequency="0.008 0.006" numOctaves="3" seed="7" result="noise">' + anim + '</feTurbulence>' +
      '<feDiffuseLighting in="noise" lighting-color="white" surfaceScale="8" result="light">' +
      '<feDistantLight azimuth="45" elevation="22"/></feDiffuseLighting>' +
      '<feComponentTransfer in="light">' +
      '<feFuncR type="linear" slope="0.23" intercept="0.72"/>' +
      '<feFuncG type="linear" slope="0.22" intercept="0.68"/>' +
      '<feFuncB type="linear" slope="0.22" intercept="0.60"/>' +
      '</feComponentTransfer></filter></defs></svg>';
    document.body.appendChild(wrap);
    const caustics = document.querySelector('.stat-band-caustics');
    if (caustics) caustics.style.filter = "url('#caustic-light')";
  }

  // ── Marine-life carousel — scroll-snap position <-> index, prev/next ─────
  function initCarousel() {
    const car = document.getElementById('marine-carousel');
    const countEl = document.getElementById('carousel-count');
    const prevBtn = document.getElementById('carousel-prev');
    const nextBtn = document.getElementById('carousel-next');
    if (!car || !countEl || !prevBtn || !nextBtn) return;
    const SLIDE_COUNT = car.children.length;
    let idx = 0;

    function updateCount() { countEl.textContent = `${idx + 1} / ${SLIDE_COUNT}`; }
    function goTo(i) {
      idx = Math.max(0, Math.min(SLIDE_COUNT - 1, i));
      car.scrollTo({ left: idx * car.clientWidth, behavior: 'smooth' });
      updateCount();
    }
    car.addEventListener('scroll', () => {
      if (!car.clientWidth) return;
      const i = Math.round(car.scrollLeft / car.clientWidth);
      if (i !== idx) { idx = Math.max(0, Math.min(SLIDE_COUNT - 1, i)); updateCount(); }
    });
    prevBtn.addEventListener('click', () => goTo(idx - 1));
    nextBtn.addEventListener('click', () => goTo(idx + 1));
    updateCount();
  }

  // The Marine/Overview/Journal tab strip used to be wired up here (a copy of
  // the app's dfTab(), js/history.js). The demo now renders all three panels
  // unrolled — a static page can't rely on anyone tapping a tab, and the
  // section's whole job is showing what a dive file holds — so there's
  // nothing left to switch.

  document.addEventListener('DOMContentLoaded', () => {
    mountCausticFilter();
    initCarousel();
    const chartEl = document.getElementById('profile-chart');
    if (chartEl) renderProfileChart(chartEl);
  });
})();
