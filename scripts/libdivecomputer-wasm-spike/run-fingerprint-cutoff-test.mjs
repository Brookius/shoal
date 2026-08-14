// Proves the fingerprint cutoff actually engages — the one behaviour from
// brief §16 that can't be inferred from reading shearwater_petrel.c, it has
// to be shown working against real protocol bytes (same discipline as
// steps 1/1b). Feeds dive #3's own fingerprint (harvested once via a
// temporary debug build, see the brief) back in as the "already known up
// to here" value and confirms the manifest cutoff stops the session after
// exactly 2 dives — the ones genuinely newer than #3 — rather than
// re-downloading all 96.
import { readFileSync } from 'node:fs';

const LOG = '/Users/lukebrook/Documents/Github/dive-log/research/ble-captures/peregrine-full-download-2026-07-13.log';
const events = [];
for (const line of readFileSync(LOG, 'utf8').split('\n')) {
  const m = /INFO: (Write|Read): size=\d+, data=([0-9A-F]+)/.exec(line);
  if (m) events.push({ dir: m[1][0], hex: m[2] });
}
const hexToBytes = (hex) => { const out = new Uint8Array(hex.length / 2); for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16); return out; };

let p = 0, packets = [], pendingWrite = [];
globalThis.dcTransport = {
  async write(bytes) {
    pendingWrite.push(...bytes);
    if (pendingWrite[pendingWrite.length - 1] !== 0xC0) return;
    const frame = pendingWrite.map((b) => b.toString(16).padStart(2, '0').toUpperCase()).join('');
    pendingWrite = [];
    for (let k = p; k < events.length; k++) {
      if (events[k].dir === 'W' && events[k].hex === frame) {
        for (let j = k + 1; j < events.length && events[j].dir === 'R'; j++) packets.push(hexToBytes(events[j].hex));
        p = k + 1; return;
      }
    }
    throw new Error(`write not in transcript: ${frame.slice(0, 60)}…`);
  },
  async read(size) {
    await Promise.resolve();
    if (!packets.length) return new Uint8Array(0);
    const pkt = packets[0];
    if (pkt.length <= size) { packets.shift(); return pkt; }
    packets[0] = pkt.subarray(size); return pkt.subarray(0, size);
  },
};

// Harvested once via a temporary stderr-only debug build (see brief §16
// step 2) — dive #3's own fingerprint out of the real 96-dive session.
const DIVE_3_FINGERPRINT = '6a03703a';

const dives = [];
let cur = null;
let newestFingerprint = null;
import { runModule } from './run-module.mjs';
const factory = (await import('./download.mjs')).default;
await runModule(factory, {
  arguments: ['Shearwater', 'Peregrine', DIVE_3_FINGERPRINT],
  print: (line) => {
    let obj; try { obj = JSON.parse(line); } catch { return; }
    if (obj.type === 'dive_start') cur = { datetime: obj.datetime };
    else if (obj.type === 'dive_end' && cur) { dives.push(cur); cur = null; }
    else if (obj.type === 'newest_fingerprint') newestFingerprint = obj.hex;
  },
});

console.error(`dives downloaded with fingerprint set to dive #3's value: ${dives.length}`);
console.error(`dates: ${JSON.stringify(dives.map((d) => d.datetime))}`);
console.error(`newest_fingerprint reported this session: ${newestFingerprint}`);

let pass = 0, fail = 0;
const assert = (c, l) => { if (c) { pass++; console.log(`  ✓ ${l}`); } else { fail++; console.log(`  ✗ FAIL: ${l}`); } };

assert(dives.length === 2, `cutoff engaged: exactly 2 dives (newer than #3), not 96 — got ${dives.length}`);
assert(newestFingerprint === '6a045bad', `newest_fingerprint still correctly reports dive #1's value (6a045bad), got ${newestFingerprint}`);
assert(dives[0]?.datetime === '2026-05-13T11:08:29', `dive 1 of 2 matches the real newest dive's known datetime, got ${dives[0]?.datetime}`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
