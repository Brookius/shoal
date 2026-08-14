// Stats, charts, and SAC calculation — extracted from index.html (modular migration, step 7).
// Classic script, loaded before the main inline script (shared global scope).
// calcSAC/sacClass also used by renderDiveFile (history dive file).

function calcSAC(d) {
  const barUsed = (parseFloat(d.pstart) || 0) - (parseFloat(d.pend) || 0);
  const cylVol  = parseFloat(d.tanksize) || 0;
  const time    = parseFloat(d.time) || 0;
  const avg     = parseFloat(d.avgdepth) || 0;
  // Only show SAC when it is genuinely accurate: needs pressure used,
  // bottom time, average depth (for depth-normalisation) AND the logged
  // tank size (a 12 L assumption can be ~20% off on a 15 L cylinder).
  if (!barUsed || !time || avg <= 0 || cylVol <= 0) return null;
  return Math.round(((barUsed * cylVol) / time / ((avg / 10) + 1)) * 10) / 10;
}

function sacClass(sac) {
  if (sac < 18) return 'dd2-sac-good';
  if (sac < 25) return 'dd2-sac-mid';
  return 'dd2-sac-high';
}


// Stats
// Shared stats bar row — thicker, neutral fill unless a colour is meaningful.
// `tex` (optional) is a TYPE_TEXTURE code — only ever passed by the dive-type
// breakdown below, gated on the primary texture-channel toggle (js/app.js).
function stBar(label, frac, val, sub, colour, tex) {
  return `<div class="st-row"><div class="st-lbl">${esc(label)}</div>
    <div class="st-trk"><div class="st-fil"${tex ? ` data-tex="${tex}"` : ''} style="width:${Math.round(frac*100)}%${colour ? ';background-color:'+colour : ''}"></div></div>
    <div class="st-val">${val}${sub ? ` <small>${sub}</small>` : ''}</div></div>`;
}

function renderStats() {
  const totalDives = dives.length;
  const totalMins = dives.reduce((s, d) => s + (parseInt(d.time) || 0), 0);
  const totalHrs = Math.floor(totalMins / 60);
  const remMins = totalMins % 60;
  const depths = dives.map(d => parseFloat(d.depth)).filter(Boolean);
  const maxDepth = depths.length ? Math.max(...depths) : null;
  const avgDepth = depths.length ? (depths.reduce((a, b) => a + b, 0) / depths.length).toFixed(1) : null;
  const sites = new Set(dives.map(d => d.site).filter(Boolean)).size;

  document.getElementById('stats-grid').innerHTML = `
    <div class="stat-card">
      <div class="stat-label">Total dives</div>
      <div class="stat-value">${totalDives}</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Time underwater</div>
      <div class="stat-value">${totalHrs > 0 ? totalHrs + '<span class="stat-unit">h</span> ' : ''}${remMins}<span class="stat-unit">m</span></div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Deepest dive</div>
      <div class="stat-value">${maxDepth !== null ? maxDepth : '—'}${maxDepth !== null ? '<span class="stat-unit">m</span>' : ''}</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Avg depth</div>
      <div class="stat-value">${avgDepth !== null ? avgDepth : '—'}${avgDepth !== null ? '<span class="stat-unit">m</span>' : ''}</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Sites visited</div>
      <div class="stat-value">${sites}</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Species logged</div>
      <div class="stat-value">${new Set(dives.flatMap(d => (d.marine||[]).map(m => typeof m === 'string' ? m : m.scientificName))).size}</div>
    </div>
  `;

  // Deepest dives — leader list. Values cluster too tightly (e.g. 24–27 m)
  // for a 0-based bar to mean anything, so the number leads, not a bar.
  const divesWithDepth = dives.filter(d => d.depth).sort((a, b) => parseFloat(b.depth) - parseFloat(a.depth)).slice(0, 5);
  if (divesWithDepth.length) {
    document.getElementById('depth-chart').style.display = 'block';
    document.getElementById('depth-list').innerHTML = divesWithDepth.map((d, i) =>
      `<div class="st-lead"><span class="rk">${i + 1}</span><span class="nm">${esc(d.site) || 'Dive ' + d.divenum}</span><span class="dots"></span><span class="mv">${parseFloat(d.depth).toFixed(1)} m</span></div>`
    ).join('');
  }

  // ── Aggregate species across all dives ──────────────────────────────────
  // Count dives where a species was seen (1 per dive), not total individuals.
  // This prevents a single shoal of 500 fish skewing the frequency chart.
  const speciesMap = {};
  dives.forEach(d => {
    const seenThisDive = new Set();
    (d.marine || []).forEach(m => {
      const name = typeof m === 'string' ? m : (m.commonName || m.scientificName);
      if (!seenThisDive.has(name)) {
        seenThisDive.add(name);
        if (!speciesMap[name]) speciesMap[name] = { dives: 0 };
        speciesMap[name].dives += 1;
      }
    });
  });
  const speciesEntries = Object.entries(speciesMap).sort((a,b) => b[1].dives - a[1].dives);

  // Most sighted species bar chart — value = number of dives where seen
  if (speciesEntries.length) {
    const maxCount = speciesEntries[0][1].dives;
    document.getElementById('species-chart').style.display = 'block';
    document.getElementById('species-bars').innerHTML = speciesEntries.slice(0,8).map(([name, data]) =>
      stBar(name, data.dives / maxCount, data.dives, data.dives === 1 ? 'dive' : 'dives')
    ).join('');
  }

  // ── Dives by country bar chart ────────────────────────────────────────────
  const countryCounts = {};
  dives.forEach(d => {
    if (d.location) countryCounts[d.location] = (countryCounts[d.location] || 0) + 1;
  });
  const countryEntries = Object.entries(countryCounts).sort((a, b) => b[1] - a[1]);
  if (countryEntries.length) {
    const maxC = countryEntries[0][1];
    document.getElementById('country-chart').style.display = 'block';
    document.getElementById('country-bars').innerHTML = countryEntries.map(([country, count]) =>
      stBar(country, count / maxC, count)
    ).join('');
  }

  // ── Top 3 species per country ─────────────────────────────────────────────
  const countrySpeciesMap = {};
  dives.forEach(d => {
    if (!d.location) return;
    if (!countrySpeciesMap[d.location]) countrySpeciesMap[d.location] = {};
    const seenThisDive = new Set();
    (d.marine || []).forEach(m => {
      const name = typeof m === 'string' ? m : (m.commonName || m.scientificName);
      if (!seenThisDive.has(name)) {
        seenThisDive.add(name);
        countrySpeciesMap[d.location][name] = (countrySpeciesMap[d.location][name] || 0) + 1;
      }
    });
  });
  const countrySpeciesEntries = Object.entries(countrySpeciesMap)
    .filter(([, sp]) => Object.keys(sp).length > 0)
    .sort((a, b) => Object.keys(b[1]).length - Object.keys(a[1]).length);

  if (countrySpeciesEntries.length) {
    document.getElementById('country-species-section').style.display = 'block';
    document.getElementById('country-species-grid').innerHTML = countrySpeciesEntries.map(([country, speciesObj]) => {
      const top3 = Object.entries(speciesObj).sort((a, b) => b[1] - a[1]).slice(0, 3);
      const rows = top3.map(([name, count]) =>
        `<div class="sp"><span>${esc(name)}</span><span class="ct">×${count}</span></div>`
      ).join('');
      return `<div class="c"><div class="cc">${esc(country)}</div>${rows}</div>`;
    }).join('');
  }

  // ── Activity over time ────────────────────────────────────────────────────
  renderActivityChart('year');

  // ── Dive type breakdown ───────────────────────────────────────────────────
  const typeCounts = {};
  dives.forEach(d => {
    const t = d.entry || 'Unspecified';
    typeCounts[t] = (typeCounts[t] || 0) + 1;
  });
  const typeEntries = Object.entries(typeCounts).sort((a, b) => b[1] - a[1]);
  if (typeEntries.length) {
    const typeColours = {
      'Boat':'var(--type-Boat)', 'Shore':'var(--type-Shore)', 'Drift':'var(--type-Drift)',
      'Night':'var(--type-Night)', 'Cave':'var(--type-Cave)', 'Wreck':'var(--type-Wreck)',
      'Reef':'var(--type-Reef)', 'Wall':'var(--type-Wall)', 'Pinnacle':'var(--type-Pinnacle)',
      'Muck':'var(--type-Muck)', 'Unspecified':'var(--text-dim)'
    };
    document.getElementById('divetype-chart').style.display = 'block';
    const dtTotal = typeEntries.reduce((s, [, n]) => s + n, 0);
    const maxCount = typeEntries[0][1];
    const texOn = typeof _texTypesOn === 'function' && _texTypesOn();
    document.getElementById('divetype-bars').innerHTML = typeEntries.map(([type, count]) => {
      const colour = typeColours[type] || 'var(--text-dim)';
      const pct = Math.round(count / dtTotal * 100);
      const tex = texOn ? TYPE_TEXTURE[type] : null; // undefined for 'Unspecified' — fine, no attribute added
      return stBar(type, count / maxCount, count, pct + '%', colour, tex);
    }).join('');
  }

  // ── SAC rate by dive type ─────────────────────────────────────────────────
  // Single source of truth: calcSAC() — strict gate, returns null unless
  // pstart−pend, bottom_time, avgdepth AND logged tanksize are all present.
  // No estimated avg depth, no assumed 12 L tank: chart and card agree.
  const sacByType = {};
  dives.forEach(d => {
    const sac = calcSAC(d);
    if (sac === null) return;          // missing one of the four fields
    if (sac < 5 || sac > 60) return;   // still drop implausible outliers
    const type = d.entry || 'Unspecified';
    if (!sacByType[type]) sacByType[type] = [];
    sacByType[type].push(sac);
  });

  const sacEntries = Object.entries(sacByType)
    .map(([type, vals]) => [type, vals.reduce((a,b) => a+b,0) / vals.length, vals.length])
    .sort((a, b) => a[1] - b[1]); // ascending — lower SAC is better

  if (sacEntries.length) {
    const maxSAC = Math.max(...sacEntries.map(e => e[1]));
    document.getElementById('sac-chart').style.display = 'block';
    document.getElementById('sac-bars').innerHTML = sacEntries.map(([type, avg, n]) => {
      // green good (<18) · neutral moderate (18–25) · danger high (>25)
      const colour = avg < 18 ? 'var(--success)' : avg < 25 ? 'var(--text-muted)' : 'var(--danger)';
      return stBar(type, avg / maxSAC, avg.toFixed(1), `${n} dive${n > 1 ? 's' : ''}`, colour);
    }).join('');
  }
}

// ── Activity chart toggle ─────────────────────────────────────────────────
function setActivityView(view) {
  const btnYear  = document.getElementById('act-btn-year');
  const btnMonth = document.getElementById('act-btn-month');
  if (btnYear && btnMonth) {
    btnYear.classList.toggle('on',  view === 'year');
    btnMonth.classList.toggle('on', view === 'month');
    // Same segmented-toggle shape as lfWireSegments/lfPaintSeg (js/logform.js)
    // — exactly one of two options always active — so aria-pressed matches
    // the convention already established there, not a competing pattern.
    btnYear.setAttribute('aria-pressed', String(view === 'year'));
    btnMonth.setAttribute('aria-pressed', String(view === 'month'));
  }
  renderActivityChart(view);
}

function renderActivityChart(view) {
  if (!dives.length) return;
  document.getElementById('activity-year-chart').style.display = 'block';
  let entries;

  if (view === 'year') {
    const buckets = {};
    dives.forEach(d => {
      if (!d.date) return;
      const year = d.date.substring(0, 4);
      buckets[year] = (buckets[year] || 0) + 1;
    });
    const years = Object.keys(buckets).map(Number).filter(y => y);
    if (years.length) {
      // Zero-fill gap years between first and last — a year with no
      // dives is real information, not a gap to hide.
      const lo = Math.min(...years), hi = Math.max(...years);
      entries = [];
      for (let y = lo; y <= hi; y++) entries.push([String(y), buckets[y] || 0]);
    } else {
      entries = [];
    }
  } else {
    // By month — aggregate across all years
    const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const buckets = {};
    monthNames.forEach(m => { buckets[m] = 0; });
    dives.forEach(d => {
      if (!d.date) return;
      const parts = d.date.split('-');
      if (parts.length < 2) return;
      const monthIdx = parseInt(parts[1]) - 1;
      if (monthIdx >= 0 && monthIdx < 12) buckets[monthNames[monthIdx]]++;
    });
    entries = monthNames.map(m => [m, buckets[m]]);
  }

  const maxV = Math.max(...entries.map(e => e[1]), 1);
  document.getElementById('activity-bars').innerHTML = entries.map(([label, count]) =>
    stBar(label, count / maxV, count)
  ).join('');
}

// Gear

