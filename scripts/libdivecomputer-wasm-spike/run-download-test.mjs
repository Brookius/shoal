// Validates download.c (the production module candidate) against the same
// real Peregrine transcript run-replay.mjs already proved the engine
// against — this time checking full waypoint extraction (t/d/temp/ndl)
// plus deco/safety-stop events, not just summary fields, since download.c
// is meant to feed real depth/time charts, not just prove the protocol
// survives WASM.
//
//   node run-download-test.mjs [transcript.log] [ground-truth.uddf]
//
// NOTE: any Node that loads ES modules will do (v22 confirmed). This used to
// require v26+ for WebAssembly.Suspending, back when the module was built
// with -sJSPI; the switch to -sASYNCIFY removed that constraint.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const LOG  = process.argv[2] || join(here, '../../research/ble-captures/peregrine-full-download-2026-07-13.log');
const UDDF = process.argv[3] || join(here, '../../research/UDDF/All dives.uddf');

// ── transcript → ordered W/R events (identical to run-replay.mjs) ─────────
const events = [];
for (const line of readFileSync(LOG, 'utf8').split('\n')) {
  const m = /INFO: (Write|Read): size=\d+, data=([0-9A-F]+)/.exec(line);
  if (m) events.push({ dir: m[1][0], hex: m[2] });
}

let p = 0, packets = [], pendingWrite = [];
const hexToBytes = (hex) => {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
};
function serveResponsesFrom(k) {
  for (let j = k + 1; j < events.length && events[j].dir === 'R'; j++) packets.push(hexToBytes(events[j].hex));
}
globalThis.dcTransport = {
  async write(bytes) {
    pendingWrite.push(...bytes);
    if (pendingWrite[pendingWrite.length - 1] !== 0xC0) return;
    const frame = pendingWrite.map(b => b.toString(16).padStart(2, '0').toUpperCase()).join('');
    pendingWrite = [];
    for (let k = p; k < events.length; k++) {
      if (events[k].dir === 'W' && events[k].hex === frame) { serveResponsesFrom(k); p = k + 1; return; }
    }
    throw new Error(`write not in transcript: ${frame.slice(0, 60)}…`);
  },
  async read(size) {
    await Promise.resolve();
    if (!packets.length) return new Uint8Array(0);
    const pkt = packets[0];
    if (pkt.length <= size) { packets.shift(); return pkt; }
    packets[0] = pkt.subarray(size);
    return pkt.subarray(0, size);
  },
};

// ── ground truth (add waypoint samples this time, not just summary) ───────
// nodecotime/decostop/gas mix pulled in too — same fields js/profile.js's
// UDDF parser already reads (see its comments), so this is the same
// independent ground truth the depth/time check above uses, extended to
// the new fields rather than a second, differently-sourced check.
const uddf = readFileSync(UDDF, 'utf8');

// Document-level <mix id="…"><o2>/<he></mix> lookup — gas mixes are
// defined once and referenced per-dive via <tankdata><link ref="…">,
// same structure js/profile.js's _parseGasLookup reads.
const mixLookup = new Map();
for (const m of uddf.matchAll(/<mix id="([^"]+)">[\s\S]*?<\/mix>/g)) {
  const o2 = /<o2>([\d.]+)<\/o2>/.exec(m[0])?.[1];
  const he = /<he>([\d.]+)<\/he>/.exec(m[0])?.[1];
  mixLookup.set(m[1], { o2: o2 != null ? +o2 : null, he: he != null ? +he : 0 });
}

const truth = [];
for (const dive of uddf.split(/<dive\b/).slice(1)) {
  const dt = /<datetime>([^<]+)<\/datetime>/.exec(dive)?.[1];
  // First <tankdata> = the back/primary gas — same "no explicit switch
  // info" fallback convention as js/profile.js and as download.c's own
  // index-0 gas-mix choice, so this is a like-for-like comparison.
  const gasRef = /<tankdata>[\s\S]*?<link ref="([^"]+)"/.exec(dive)?.[1];
  const gasMix = gasRef ? mixLookup.get(gasRef) : null;
  const samples = [...dive.matchAll(/<waypoint>[\s\S]*?<\/waypoint>/g)].map(m => {
    const t  = /<divetime>([\d.]+)<\/divetime>/.exec(m[0])?.[1];
    const d  = /<depth>([\d.]+)<\/depth>/.exec(m[0])?.[1];
    const nd = /<nodecotime>([\d.]+)<\/nodecotime>/.exec(m[0])?.[1];
    const stops = [...m[0].matchAll(/<decostop\b[^>]*>/g)].map(sm => ({
      kind: (/kind="([^"]+)"/.exec(sm[0])?.[1] || 'mandatory') === 'safety' ? 'safetystop' : 'decostop',
      depth: (() => { const v = /decodepth="([\d.]+)"/.exec(sm[0])?.[1]; return v != null ? +v : null; })(),
    }));
    return { t: t != null ? +t : null, d: d != null ? +d : null, ndlMin: nd != null ? +nd / 60 : null, stops };
  }).filter(s => s.t != null && s.d != null);
  truth.push({ datetime: dt && dt.slice(0, 19), samples, gasMix });
}

// ── assemble the streamed JSON-line protocol into dive objects ────────────
const dives = [];
let cur = null;
import { runModule } from './run-module.mjs';
const factory = (await import('./download.mjs')).default;
try {
  await runModule(factory, {
    arguments: ['Shearwater', 'Peregrine'],
    print: (line) => {
      let obj; try { obj = JSON.parse(line); } catch { return; }
      if (obj.type === 'dive_start') cur = { datetime: obj.datetime, maxdepth: obj.maxdepth, divetime: obj.divetime, o2: obj.o2, he: obj.he, waypoints: [], events: [] };
      else if (obj.type === 'waypoint' && cur) cur.waypoints.push(obj);
      else if (obj.type === 'deco_event' && cur) cur.events.push(obj);
      else if (obj.type === 'dive_end' && cur) { dives.push(cur); cur = null; }
    },
  });
} catch (e) {
  console.error('ENGINE FAILED:', e.message || e);
  process.exit(1);
}

// ── diff ────────────────────────────────────────────────────────────────
console.error(`downloaded ${dives.length} dives (truth: ${truth.length})`);
const byDt = new Map(truth.filter(t => t.datetime).map(t => [t.datetime, t]));

let pass = dives.length === truth.length;
let checkedWaypoints = 0, waypointDepthOk = 0, worstWpDepth = 0;
let sparseDives = 0;
let ndlChecked = 0, ndlOk = 0, worstNdl = 0;
let divesWithNdl = 0, divesWithDeco = 0, totalDecoEvents = 0;
let truthDecoStops = 0;
let gasChecked = 0, gasOk = 0, divesWithGas = 0;
const gasMismatches = [];
for (const d of dives) {
  const t = byDt.get(d.datetime);
  if (!t) { console.error(`  no ground truth for ${d.datetime}`); pass = false; continue; }
  if (!d.waypoints.length) { sparseDives++; continue; }
  if (d.waypoints.some(w => w.ndl != null)) divesWithNdl++;
  if (d.events.length) { divesWithDeco++; totalDecoEvents += d.events.length; }
  if (d.o2 != null) divesWithGas++;
  // Gas mix cross-check — dive-level, not per-waypoint (one mix per dive
  // in this simple/common case). Both sides express o2/he as 0-1 fractions
  // straight off DC_FIELD_GASMIX / UDDF's <o2>/<he>, so exact match modulo
  // float rounding, not a "roughly agrees" tolerance like NDL's minute
  // granularity needed.
  if (d.o2 != null && t.gasMix && t.gasMix.o2 != null) {
    gasChecked++;
    const o2Match = Math.abs(d.o2 - t.gasMix.o2) <= 0.005;
    const heMatch = Math.abs((d.he || 0) - (t.gasMix.he || 0)) <= 0.005;
    if (o2Match && heMatch) gasOk++;
    else gasMismatches.push(`${d.datetime}: parsed o2=${d.o2} he=${d.he} vs UDDF o2=${t.gasMix.o2} he=${t.gasMix.he}`);
  }
  // spot-check every waypoint's depth against the nearest-time UDDF sample
  // (UDDF sample times are libdivecomputer's own DIVETIME-derived seconds
  // too, same source data — should align closely, not just "some curve")
  for (const wp of d.waypoints) {
    const nearest = t.samples.reduce((best, s) =>
      Math.abs(s.t - wp.t) < Math.abs(best.t - wp.t) ? s : best, t.samples[0] || { t: Infinity, d: 0 });
    if (!t.samples.length) continue;
    checkedWaypoints++;
    const dd = Math.abs(nearest.d - wp.d);
    worstWpDepth = Math.max(worstWpDepth, dd);
    if (dd <= 0.3) waypointDepthOk++; // 0.3m: UDDF may resample/round independently of raw sample cadence
    // NDL cross-check — same nearest-sample match as depth above. Both our
    // C code and js/profile.js's UDDF parser convert seconds→minutes with
    // the same /60 + one-decimal rounding, from the same underlying
    // computer log, so this should track tightly, not just "roughly agree".
    if (wp.ndl != null && nearest.ndlMin != null) {
      ndlChecked++;
      const nd = Math.abs(nearest.ndlMin - wp.ndl);
      worstNdl = Math.max(worstNdl, nd);
      if (nd <= 0.15) ndlOk++; // 0.15min = 9s slack for independent rounding
    }
  }
  for (const s of t.samples) truthDecoStops += s.stops.length;
}
const wpPass  = checkedWaypoints > 0 && (waypointDepthOk / checkedWaypoints) >= 0.98;
const ndlPass = ndlChecked === 0 || (ndlOk / ndlChecked) >= 0.98;
const gasPass = gasChecked === 0 || (gasOk / gasChecked) === 1; // exact-match field, no rounding budget
console.error(`waypoints checked: ${checkedWaypoints}, depth within 0.3m: ${waypointDepthOk} (${(100 * waypointDepthOk / checkedWaypoints).toFixed(1)}%), worst diff ${worstWpDepth.toFixed(2)}m`);
console.error(`dives with zero waypoints: ${sparseDives}/${dives.length}`);
console.error(`NDL: ${divesWithNdl}/${dives.length} dives carry it; ${ndlChecked} samples cross-checked, within 0.15min: ${ndlOk} (${ndlChecked ? (100 * ndlOk / ndlChecked).toFixed(1) : '—'}%), worst diff ${worstNdl.toFixed(2)}min`);
console.error(`deco/safety events: ${divesWithDeco}/${dives.length} dives, ${totalDecoEvents} events parsed (UDDF ground truth: ${truthDecoStops} <decostop> samples)`);
if (divesWithDeco) {
  const example = dives.find(d => d.events.length);
  console.error(`  example (${example.datetime}): ${JSON.stringify(example.events.slice(0, 3))}${example.events.length > 3 ? ` … +${example.events.length - 3} more` : ''}`);
}
console.error(`gas mix: ${divesWithGas}/${dives.length} dives carry it; ${gasChecked} cross-checked against UDDF, exact match: ${gasOk} (${gasChecked ? (100 * gasOk / gasChecked).toFixed(1) : '—'}%)`);
if (gasMismatches.length) console.error(`  MISMATCHES:\n    ${gasMismatches.join('\n    ')}`);
console.error(`sample dive[0]: ${JSON.stringify({ ...dives[0], waypoints: `[${dives[0]?.waypoints.length} points]`, events: `[${dives[0]?.events.length} events]` })}`);

// Deco-event counts aren't gated into pass/fail: real dives vary in whether
// they trigger any stop at all, so "0 events" can be entirely correct for
// a shallow no-deco dataset — the meaningful check is the NDL cross-match
// above (present on every dive with a computer that reports it) plus, when
// truthDecoStops > 0, that our own count is in the same ballpark (not
// exact — "one event per sample" can differ slightly by sample alignment).
if (truthDecoStops > 0 && totalDecoEvents === 0) {
  console.error('  WARNING: UDDF ground truth has decostop samples but download.c parsed none — investigate before trusting this build');
  pass = false;
}

pass = pass && wpPass && ndlPass && gasPass && sparseDives === 0;
console.error(pass ? 'DOWNLOAD MODULE: PASS' : 'DOWNLOAD MODULE: DIVERGENCE — see numbers above');
process.exit(pass ? 0 : 1);
