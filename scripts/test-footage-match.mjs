// Verifies footage-match.js's pure logic without a browser:
//  - the ISO-BMFF box walk, including moov-at-END (the GoPro case that a
//    fixed-prefix read would miss — the whole reason the walk exists)
//  - 64-bit box sizes and mvhd version 1
//  - the dive-window fallback chain
//  - matching, including the tight +/-10min window on consecutive dives
//
// Run from anywhere:  node scripts/test-footage-match.mjs
// Also worth running under a second timezone to prove capture-time reading is
// zone-independent:  TZ=Asia/Jakarta node scripts/test-footage-match.mjs
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../js/footage-match.js', import.meta.url), 'utf8');

// The module is a classic script referencing app globals only inside function
// bodies, so it evaluates fine with them injected here.
const load = (dives) => new Function(
  'dives', 'esc', '_VIDEO_EXTS', '_fmPush', 'document', 'localStorage', 'renderHistory',
  src + '; return { _fmatReadCaptureTime, _fmatDiveWindow, _fmatMatchAll, _fmatLocalDate, _fmatSourceFor };'
)(dives, (s) => s, ['mp4', 'mov'], async () => {}, { getElementById: () => null }, { setItem() {} }, null);

const EPOCH_1904 = 2082844800;
const b = (n) => { const x = Buffer.alloc(4); x.writeUInt32BE(n); return x; };

function box(type, payload) {
  return Buffer.concat([b(8 + payload.length), Buffer.from(type, 'ascii'), payload]);
}

// Encodes the WALL-CLOCK reading the camera was set to, which is what real
// action cameras write into mvhd (nominally a UTC field). Using Date.UTC on
// the local components is how you express "09:20 on the camera's own clock"
// independently of whatever timezone this test happens to run in.
const wallSecs = (d) => Math.floor(Date.UTC(
  d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds()
) / 1000) + EPOCH_1904;

// mvhd v0: version(1) flags(3) creation(4) modification(4) timescale(4) duration(4)
function mvhdV0(date) {
  const secs = wallSecs(date);
  return box('mvhd', Buffer.concat([
    Buffer.from([0, 0, 0, 0]), b(secs), b(secs), b(1000), b(60000),
  ]));
}
// mvhd v1 uses 64-bit creation/modification times.
function mvhdV1(date) {
  const secs = BigInt(wallSecs(date));
  const big = Buffer.alloc(8); big.writeBigUInt64BE(secs);
  return box('mvhd', Buffer.concat([
    Buffer.from([1, 0, 0, 0]), big, big, b(1000), b(60000),
  ]));
}
// A 64-bit-sized box: size field == 1, real size in the 8 bytes after the type.
function largeBox(type, payload) {
  const size = Buffer.alloc(8);
  size.writeBigUInt64BE(BigInt(16 + payload.length));
  return Buffer.concat([b(1), Buffer.from(type, 'ascii'), size, payload]);
}

const ftyp = box('ftyp', Buffer.from('isomiso2mp41', 'ascii'));
const mdat = box('mdat', Buffer.alloc(4096, 7)); // stand-in for real video payload

const CAPTURED = new Date(2026, 4, 13, 9, 20, 0); // 2026-05-13 09:20 local

let pass = true;
const check = (ok, label) => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`); if (!ok) pass = false; };

const { _fmatReadCaptureTime, _fmatDiveWindow, _fmatMatchAll, _fmatSourceFor } = load([]);

// Build the same byte source js/video.js's browser scan produces, so the test
// exercises the real _fmatSourceFor path rather than a stand-in.
const srcOf = (file) => _fmatSourceFor({
  name: file.name, relPath: file.name, size: file.size,
  modified: file.lastModified, file,
});

console.log('Container parsing');

// 1. moov at the END — the GoPro layout.
{
  const file = new File([Buffer.concat([ftyp, mdat, box('moov', mvhdV0(CAPTURED))])], 'GX010128.MP4');
  const r = await _fmatReadCaptureTime(srcOf(file));
  check(r && r.source === 'container' && Math.abs(r.ms - CAPTURED.getTime()) < 1000,
    `moov at END of file → ${r ? new Date(r.ms).toISOString() : 'null'} (${r && r.source})`);
}

// 2. moov at the front (typical faststart .MOV).
{
  const file = new File([Buffer.concat([ftyp, box('moov', mvhdV0(CAPTURED)), mdat])], 'clip.MOV');
  const r = await _fmatReadCaptureTime(srcOf(file));
  check(r && r.source === 'container' && Math.abs(r.ms - CAPTURED.getTime()) < 1000, 'moov at FRONT of file');
}

// 3. mvhd version 1 (64-bit times).
{
  const file = new File([Buffer.concat([ftyp, mdat, box('moov', mvhdV1(CAPTURED))])], 'v1.mp4');
  const r = await _fmatReadCaptureTime(srcOf(file));
  check(r && r.source === 'container' && Math.abs(r.ms - CAPTURED.getTime()) < 1000, 'mvhd version 1 (64-bit creation_time)');
}

// 4. A 64-bit-sized mdat must be skipped correctly to reach moov beyond it.
{
  const file = new File([Buffer.concat([ftyp, largeBox('mdat', Buffer.alloc(2048, 3)), box('moov', mvhdV0(CAPTURED))])], 'big.mp4');
  const r = await _fmatReadCaptureTime(srcOf(file));
  check(r && r.source === 'container', '64-bit box size skipped correctly');
}

// 5. No moov at all → fall back to the filesystem mtime.
{
  const mtime = new Date(2026, 4, 14, 11, 0, 0).getTime();
  const file = new File([Buffer.concat([ftyp, mdat])], 'nomoov.mp4', { lastModified: mtime });
  const r = await _fmatReadCaptureTime(srcOf(file));
  check(r && r.source === 'modified' && r.ms === mtime, 'no moov → falls back to file mtime');
}

// 6. An unset camera clock (1904 epoch) must be rejected, not trusted.
{
  const file = new File([Buffer.concat([ftyp, box('moov', mvhdV0(new Date(1904, 0, 1)))])], 'unset.mp4',
    { lastModified: new Date(2026, 4, 14).getTime() });
  const r = await _fmatReadCaptureTime(srcOf(file));
  check(r && r.source === 'modified', 'implausible 1904 timestamp rejected → mtime fallback');
}

// 7. Timezone stability: the SAME file must parse to the same wall-clock
//    reading regardless of the machine's timezone, or the same footage would
//    match differently depending on where it's reviewed from.
{
  const bytes = Buffer.concat([ftyp, mdat, box('moov', mvhdV0(CAPTURED))]);
  const readIn = async (tz) => {
    const prev = process.env.TZ;
    process.env.TZ = tz;
    try {
      // Re-evaluate the module so its Date maths picks up the new zone, and
      // read the result back BEFORE restoring — reading it in a different
      // zone than it was constructed in measures the wrong thing.
      const { _fmatReadCaptureTime: f, _fmatSourceFor } = load([]);
      const r = await f(_fmatSourceFor({ name: 'tz.mp4', relPath: 'tz.mp4', size: bytes.length, modified: Date.now(), file: new File([bytes], 'tz.mp4') }));
      const d = new Date(r.ms);
      return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
    } finally {
      process.env.TZ = prev;
    }
  };
  const utc = await readIn('UTC');
  const jakarta = await readIn('Asia/Jakarta');
  const la = await readIn('America/Los_Angeles');
  check(utc === '9:20' && jakarta === '9:20' && la === '9:20',
    `same file reads 09:20 in every timezone (UTC=${utc}, Jakarta=${jakarta}, LA=${la})`);
}

// 8. Truncated/garbage container must not throw.
{
  const file = new File([Buffer.from([0, 0, 0, 5, 0x6d, 0x6f, 0x6f])], 'trunc.mp4', { lastModified: Date.now() });
  let threw = false;
  try { await _fmatReadCaptureTime(srcOf(file)); } catch { threw = true; }
  check(!threw, 'malformed container does not throw');
}

console.log('\nDive windows (the missing-time fallback chain)');
{
  const w1 = _fmatDiveWindow({ date: '2026-05-13', entrytime: '09:15', exittime: '10:10' });
  check(w1.kind === 'timed' && !w1.assumed && (w1.endMs - w1.startMs) === 55 * 60000, 'entry + exit → exact window');

  const w2 = _fmatDiveWindow({ date: '2026-05-13', entrytime: '09:15', time: 55 });
  check(w2.kind === 'timed' && !w2.assumed && (w2.endMs - w2.startMs) === 55 * 60000, 'entry + bottom time → derived exit');

  const w3 = _fmatDiveWindow({ date: '2026-05-13', entrytime: '09:15' });
  check(w3.kind === 'timed' && w3.assumed === true && (w3.endMs - w3.startMs) === 60 * 60000, 'entry only → assumed length, FLAGGED');

  const w4 = _fmatDiveWindow({ date: '2026-05-13' });
  check(w4.kind === 'dateOnly', 'date only → dateOnly (suggestion path)');

  const w5 = _fmatDiveWindow({ entrytime: '09:15' });
  check(w5.kind === 'none', 'no date → unmatchable');

  const w6 = _fmatDiveWindow({ date: '2026-05-13', entrytime: '23:40', exittime: '00:25' });
  check(w6.kind === 'timed' && (w6.endMs - w6.startMs) === 45 * 60000, 'exit before entry → midnight wrap handled');
}

console.log('\nMatching');
{
  const testDives = [
    { id: 1, divenum: 141, date: '2026-05-13', site: 'A', entrytime: '09:15', exittime: '10:10' },
    { id: 2, divenum: 142, date: '2026-05-13', site: 'B', entrytime: '13:00', exittime: '13:50' },
    { id: 3, divenum: 143, date: '2026-05-14', site: 'C' }, // date only
  ];
  const m = load(testDives)._fmatMatchAll;
  const at = (h, mi) => new Date(2026, 4, 13, h, mi).getTime();

  const r = m([
    { name: 'in-dive-1.mp4',  ms: at(9, 30) },
    { name: 'pre-dive-1.mp4', ms: at(9, 8) },   // 7 min before entry — inside the 10min pad
    { name: 'in-dive-2.mp4',  ms: at(13, 20) },
    { name: 'surface.mp4',    ms: at(11, 30) }, // mid surface interval — should NOT match
    { name: 'day2.mp4',       ms: new Date(2026, 4, 14, 10, 0).getTime() },
  ], 0);

  const forName = (n) => r.matched.find(x => x.item.name === n);
  check(forName('in-dive-1.mp4')?.dive.divenum === 141, 'video during dive 1 → #141');
  check(forName('pre-dive-1.mp4')?.dive.divenum === 141, 'video 7min before entry → #141 (inside pad)');
  check(forName('in-dive-2.mp4')?.dive.divenum === 142, 'video during dive 2 → #142 (consecutive dives resolve separately)');
  check(r.unmatched.some(u => u.name === 'surface.mp4'), 'surface-interval video → unmatched, not force-assigned');
  check(r.suggested.length === 1 && r.suggested[0].dive.divenum === 143, 'date-only dive → suggestion, not auto-assign');
  check(r.skipped.dateOnly === 1 && r.skipped.noDate === 0, 'skipped dives reported for the summary');

  // Offset: the same footage shot with the camera 8h off should match at +8h.
  const shifted = [{ name: 'x.mp4', ms: at(9, 30) - 8 * 3600000 }];
  check(m(shifted, 0).matched.length === 0, 'wrong clock → no match at offset 0');
  check(m(shifted, 8).matched.length === 1, 'wrong clock → matches at +8h offset');
}

console.log(pass ? '\nFOOTAGE MATCH: PASS' : '\nFOOTAGE MATCH: FAIL');
process.exit(pass ? 0 : 1);
