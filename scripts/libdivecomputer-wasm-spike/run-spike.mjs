// JS driver for the suspension spike (build with build.sh first). A loopback
// byte queue stands in for the BLE GATT characteristic — one shared mock
// serving every protocol family spike.c exercises (Shearwater, Suunto, …):
// writes land in the queue, reads drain it, and every operation goes through
// a genuine `await`, so if suspension didn't work, Stage A would deadlock
// instantly (C blocks on a read that only the JS event loop can satisfy).
// Originally proved this under JSPI; the mechanism is Asyncify now (see
// build.sh), and this spike is mechanism-agnostic — it tests that the
// suspension happens, not how.
const hex = (u8) => [...u8].map((b) => b.toString(16).padStart(2, '0')).join(' ');
const tick = (ms) => new Promise((r) => setTimeout(r, ms));

let suspensions = 0;

globalThis.spike = {
  queue: [],
  async write(bytes) {
    suspensions++;
    await tick(1); // force a real event-loop round-trip
    console.log(`  [js] C wrote ${bytes.length}B: ${hex(bytes)}`);
    this.queue.push(...bytes);
  },
  async read(size) {
    suspensions++;
    await tick(1);
    const out = Uint8Array.from(this.queue.splice(0, size));
    console.log(`  [js] C read  ${out.length}B: ${hex(out) || '(empty)'}`);
    return out;
  },
};

import { runModule } from './run-module.mjs';
const factory = (await import('./spike.mjs')).default;

try {
  await runModule(factory);
  console.log(`\nsuspension points crossed: ${suspensions}`);
  // Says "SUSPENSION", not "JSPI": the mechanism changed to Asyncify
  // (build.sh) so the module can run outside Chromium. What this spike
  // proves is unchanged either way — that libdivecomputer's blocking
  // dc_custom_open() I/O can suspend on a real JS promise at all.
  console.log(suspensions > 0 ? 'SUSPENSION: CONFIRMED' : 'SUSPENSION: NEVER HAPPENED?');
} catch (e) {
  console.error('MODULE FAILED:', e);
  process.exit(1);
}
