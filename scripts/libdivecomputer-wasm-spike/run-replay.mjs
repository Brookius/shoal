// Step 1 replay driver — plays a recorded Peregrine BLE transcript back to
// the WASM protocol engine (replay.c) and diffs the parsed dives against
// Subsurface's UDDF export of the same computer.
//
//   node run-replay.mjs [transcript.log] [ground-truth.uddf]
//
// Both inputs are personal dive data and live OUTSIDE the repo (gitignored
// research/); defaults point at the 2026-07-13 Peregrine capture.
//
// Matching model: the Shearwater protocol is strict request/response over
// SLIP frames. Every complete frame the engine writes is matched against the
// next Write in the transcript (scan-forward, so extra requests a different
// libdivecomputer version made are skipped); the Reads that followed it are
// queued as the response stream. A write with no matching transcript frame
// fails loudly — that means our vendored version diverges from the capture.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const LOG  = process.argv[2] || join(here, '../../research/ble-captures/peregrine-full-download-2026-07-13.log');
const UDDF = process.argv[3] || join(here, '../../research/UDDF/All dives.uddf');

// ── transcript → ordered W/R events ───────────────────────────────────────
const events = [];
for (const line of readFileSync(LOG, 'utf8').split('\n')) {
  const m = /INFO: (Write|Read): size=\d+, data=([0-9A-F]+)/.exec(line);
  if (m) events.push({ dir: m[1][0], hex: m[2] });
}
console.error(`transcript: ${events.filter(e => e.dir === 'W').length} writes, ${events.filter(e => e.dir === 'R').length} reads`);

// ── the mock Peregrine ─────────────────────────────────────────────────────
// CRITICAL FRAMING FACT (discovered when a byte-stream mock failed with
// "Invalid packet header"): Shearwater BLE responses are packetized — a long
// response spans several GATT notifications, each with its own 02 <seq>
// header — and shearwater_common reads them ONE PACKET PER dc_iostream_read,
// trusting notification boundaries. The mock must serve packet-per-read, and
// so must the real Web Bluetooth transport: never coalesce notifications
// into a stream.
let p = 0;               // transcript cursor
let packets = [];        // queue of device→host packets (one per notification)
let pendingWrite = [];   // host bytes until a complete SLIP frame (0xC0)
let unmatched = null;

const hexToBytes = (hex) => {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
};

function serveResponsesFrom(k) {
  // queue every Read after event k (one packet each), up to the next Write
  for (let j = k + 1; j < events.length && events[j].dir === 'R'; j++)
    packets.push(hexToBytes(events[j].hex));
}

globalThis.spike = {
  async write(bytes) {
    pendingWrite.push(...bytes);
    if (pendingWrite[pendingWrite.length - 1] !== 0xC0) return; // frame incomplete
    const frame = pendingWrite.map(b => b.toString(16).padStart(2, '0').toUpperCase()).join('');
    pendingWrite = [];
    for (let k = p; k < events.length; k++) {
      if (events[k].dir === 'W' && events[k].hex === frame) {
        serveResponsesFrom(k);
        p = k + 1;
        return;
      }
    }
    unmatched = frame;
    throw new Error(`write not in transcript: ${frame.slice(0, 60)}…`);
  },
  async read(size) {
    await Promise.resolve(); // yield — a genuine suspension point per read
    if (!packets.length) return new Uint8Array(0);
    const pkt = packets[0];
    if (pkt.length <= size) { packets.shift(); return pkt; }
    // engine asked for less than one notification — hand out the remainder
    // next time (shouldn't happen with Shearwater's SZ_PACKET reads, but
    // degrade honestly rather than silently truncating)
    packets[0] = pkt.subarray(size);
    return pkt.subarray(0, size);
  },
};

// ── ground truth from the UDDF ─────────────────────────────────────────────
const uddf = readFileSync(UDDF, 'utf8');
const truth = [];
for (const dive of uddf.split(/<dive\b/).slice(1)) {
  const dt  = /<datetime>([^<]+)<\/datetime>/.exec(dive)?.[1] ?? null;
  const dep = /<greatestdepth>([\d.]+)<\/greatestdepth>/.exec(dive)?.[1];
  const dur = /<diveduration>([\d.]+)<\/diveduration>/.exec(dive)?.[1];
  truth.push({ datetime: dt && dt.slice(0, 19), maxdepth: dep ? +dep : null, divetime: dur ? +dur : null });
}
console.error(`ground truth: ${truth.length} dives in UDDF`);

// ── run ────────────────────────────────────────────────────────────────────
const parsed = [];
import { runModule } from './run-module.mjs';
const factory = (await import('./replay.mjs')).default;
try {
  await runModule(factory, { print: (line) => { try { parsed.push(JSON.parse(line)); } catch { console.error('bad JSON:', line); } } });
} catch (e) {
  console.error('ENGINE FAILED:', e.message || e);
  if (unmatched) console.error('protocol divergence at frame:', unmatched);
  process.exit(1);
}

// ── diff ───────────────────────────────────────────────────────────────────
const byDt = new Map(truth.filter(t => t.datetime).map(t => [t.datetime, t]));
let matched = 0, depthOk = 0, timeOk = 0, missing = 0;
let worstDepth = 0, worstTime = 0;
const timeDiffs = {}; // signed truth-minus-parsed histogram — a definition
                      // difference shows up as a consistent quantized skew,
                      // corruption as random scatter
for (const d of parsed) {
  const t = d.datetime && byDt.get(d.datetime);
  if (!t) { missing++; continue; }
  matched++;
  const dd = Math.abs((t.maxdepth ?? 0) - d.maxdepth);
  const sdt = (t.divetime ?? 0) - d.divetime;
  const dt = Math.abs(sdt);
  timeDiffs[sdt] = (timeDiffs[sdt] || 0) + 1;
  worstDepth = Math.max(worstDepth, dd);
  worstTime  = Math.max(worstTime, dt);
  if (dd <= 0.15) depthOk++;
  // 60s, not 5s: Subsurface's <diveduration> counts to the last sample while
  // libdivecomputer's DIVETIME is the computer's own logged dive time (excludes
  // trailing surface seconds) — a one-direction 3–26s definitional skew across
  // the 2026-07-13 Peregrine capture (see histogram), not a parse defect.
  // Depth + datetime exactness above are the real integrity gates.
  if (dt <= 60)   timeOk++;
}
console.error('duration diff histogram (uddf − parsed, seconds → dives):',
  Object.entries(timeDiffs).sort((a, b) => +a[0] - +b[0]).map(([k, v]) => `${k}s×${v}`).join(' '));

console.error(`\nparsed ${parsed.length}/${truth.length} dives · datetime-matched ${matched} (${missing} unmatched)`);
console.error(`depth within 0.15m: ${depthOk}/${matched} (worst ${worstDepth.toFixed(2)}m) · duration within 60s: ${timeOk}/${matched} (worst ${worstTime}s)`);
const pass = parsed.length === truth.length && matched === parsed.length && depthOk === matched && timeOk === matched;
console.error(pass ? 'REPLAY: PASS' : 'REPLAY: DIVERGENCE — see numbers above');
process.exit(pass ? 0 : 1);
