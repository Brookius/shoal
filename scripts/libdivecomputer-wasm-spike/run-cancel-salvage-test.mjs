// Regression test for the ONE invariant the Asyncify switch could plausibly
// have broken silently: cancelling a sync partway through must still leave
// every dive downloaded so far intact, and must let the C engine unwind
// cleanly rather than hang.
//
// Why this needs its own test. Under the old -sJSPI build, cancelling closed
// the GATT link out from under an in-flight write, that write threw, and the
// rejection propagated out of factory() into js/computer-sync.js's catch
// block, which salvaged the collected dives. Under -sASYNCIFY a rejected
// EM_ASYNC_JS promise has nowhere to propagate TO — the C stack stays
// suspended forever, main() never returns, onExit never fires, and the sync
// hangs with no error and no dives. So computer-sync.js's write wrapper now
// swallows the failure and fails the packet queue instead, converting a
// cancel into the read-timeout path (DC_STATUS_TIMEOUT) the engine already
// knows how to exit through. This test proves that conversion actually works
// against the real device protocol, because losing dives on cancel is a bug
// this feature has already shipped once (BRIEF-dive-computer-sync.md §15).
//
//   node run-cancel-salvage-test.mjs [transcript.log]
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { runModule } from './run-module.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const LOG = process.argv[2] || join(here, '../../research/ble-captures/peregrine-full-download-2026-07-13.log');

const events = [];
for (const line of readFileSync(LOG, 'utf8').split('\n')) {
  const m = /INFO: (Write|Read): size=\d+, data=([0-9A-F]+)/.exec(line);
  if (m) events.push({ dir: m[1][0], hex: m[2] });
}
const toBytes = (h) => new Uint8Array(h.match(/../g).map((x) => parseInt(x, 16)));

// Cancel after this many dives have completed — deep enough that real dives
// are already banked, early enough that plenty remain undownloaded.
const CANCEL_AFTER_DIVES = 3;

let cursor = 0;
let cancelled = false;
let dives = 0;

// Mirrors _makePacketQueue()'s failure semantics in js/computer-sync.js: a
// failed queue resolves pending and subsequent reads with zero bytes, which
// cb_read turns into DC_STATUS_TIMEOUT.
let failed = false;
globalThis.dcTransport = {
  async read() {
    if (failed) return new Uint8Array(0);
    while (cursor < events.length && events[cursor].dir !== 'R') cursor++;
    return cursor < events.length ? toBytes(events[cursor++].hex) : new Uint8Array(0);
  },
  // The wrapper under test: never rejects, fails the queue instead.
  async write() {
    try {
      if (cancelled) throw new Error('simulated: link closed by cancel');
      while (cursor < events.length && events[cursor].dir !== 'W') cursor++;
      if (cursor < events.length) cursor++;
    } catch (e) {
      failed = true;
    }
  },
};

const factory = (await import('./download.mjs')).default;
const started = Date.now();
let exitCode = null;
try {
  const { code } = await runModule(factory, {
    arguments: ['Shearwater', 'Peregrine'],
    print: (line) => {
      let obj; try { obj = JSON.parse(line); } catch { return; }
      if (obj.type !== 'dive_end') return;
      dives++;
      if (dives === CANCEL_AFTER_DIVES && !cancelled) {
        cancelled = true;
        failed = true; // what cancelBluetoothSync() does: queue.fail() + close
      }
    },
  });
  exitCode = code;
} catch (e) {
  console.error(`ENGINE THREW instead of unwinding cleanly: ${e.message}`);
  process.exit(1);
}

const elapsed = Date.now() - started;
let pass = true;
const check = (ok, msg) => { console.log(`  ${ok ? '✓' : '✗'} ${msg}`); if (!ok) pass = false; };

console.log(`cancelled after ${CANCEL_AFTER_DIVES} dives; engine exited code=${exitCode} in ${elapsed}ms with ${dives} dives collected`);
check(dives >= CANCEL_AFTER_DIVES, `dives downloaded before the cancel are retained, not discarded — got ${dives}`);
check(dives < 96, `the sync genuinely stopped early rather than running to completion — got ${dives} of 96`);
check(exitCode !== null, 'onExit fired, so the engine unwound rather than hanging suspended');

console.log(pass ? '\nCANCEL SALVAGE: PASS' : '\nCANCEL SALVAGE: FAIL');
process.exit(pass ? 0 : 1);
