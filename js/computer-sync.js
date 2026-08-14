// BLE dive-computer sync (BRIEF-dive-computer-sync.md, step 2). Web
// Bluetooth transport ⇄ the vendored libdivecomputer WASM module
// (vendor/libdivecomputer-wasm/) — pair, download, hand parsed dives to
// the exact same landing pipeline bulk UDDF import uses (js/profile.js).
//
// Transport only. All protocol parsing happens in the WASM module; this
// file's entire job is pumping bytes between a GATT characteristic and
// the module's async read/write callbacks. See vendor/libdivecomputer-wasm/
// README.md for what the module does and doesn't extract yet.
//
// CRITICAL FRAMING RULE (found empirically in step 1, replaying a real
// capture): Shearwater BLE responses are packetized — a long response spans
// multiple GATT notifications, each carrying its own protocol sub-header —
// and the parser relies on ONE PACKET PER READ CALL, i.e. notification
// boundaries ARE protocol framing. Never coalesce notifications into a byte
// stream; queue each characteristicvaluechanged event as a discrete packet.

const BLE_SERVICES = [
  { uuid: 'fe25c237-0ece-443c-b0aa-e02033e7029d', vendor: 'Shearwater', product: 'Peregrine' },
  { uuid: '98ae7120-e62e-11e3-badd-0002a5d5c51b', vendor: 'Suunto',     product: 'EON Steel' },
  // One representative model per family is enough — descriptor.c shows
  // every BLE model in a family shares one protocol driver, and the real
  // hardware auto-detects at handshake time regardless of which specific
  // descriptor string opened the connection (confirmed empirically against
  // a real Peregrine — see vendor/libdivecomputer-wasm/README.md).
];

// Two transports, one protocol engine. The browser uses Web Bluetooth; the
// Tauri shell can't (WKWebView has no navigator.bluetooth at all) and goes
// through native Rust commands instead (src-tauri/src/ble.rs). Everything
// downstream of _openTransport — the packet queue, the WASM module, dive
// assembly, fingerprints, routing — is identical under both.
function _webBluetoothSupported() {
  return typeof navigator !== 'undefined' && 'bluetooth' in navigator;
}

// Set by the capability probe at the bottom of this file. Native BLE can't be
// detected synchronously (it's an async invoke, and a Mac with Bluetooth
// switched off should count as unsupported), so the answer is cached here
// once rather than re-asked on every call.
let _nativeBleReady = false;

function bleSyncSupported() {
  return _webBluetoothSupported() || _nativeBleReady;
}

// A dive computer has tens or hundreds of dives waiting; without a real
// destination configured first, every one of them lands in localStorage
// only (saveDive()'s own fallback when syncMode is 'none', or 'obsidian'
// with Obsidian unreachable) with no automatic path out — connecting a
// folder afterward pulls FROM the folder, it doesn't push existing
// localStorage-only dives INTO one. Found live: BLE sync started
// downloading before a folder had ever been picked, leaving a pile of
// dives stuck in the browser with no obvious way to get them into a vault.
// Mirrors saveDive()'s own "will this dive actually go anywhere" check
// (js/app.js) rather than inventing a new rule.
function _bleHasSyncDestination() {
  if (syncMode === 'obsidian') return obsAvailable;
  if (syncMode === 'folder') {
    // Browser folder handles can lose write permission across a reload
    // without any visible error (see _folderNeedsReconnect, js/app.js) — a
    // dive computer sync is exactly the moment that silent failure would
    // hurt most, so it counts as "no destination" here too. The desktop
    // shell's native fs access has no equivalent revocable-permission
    // concept, but Android's SAF grant does (same _folderNeedsReconnect
    // flag covers it — see getWritableFolderHandle's Android analogue in
    // setDiveFolder/writeToFolder, js/app.js).
    if (isAndroidShell()) return !!_androidFolder() && !_folderNeedsReconnect;
    if (isDesktopShell()) return !!localStorage.getItem('divelog-shell-vault-path');
    return !!_folderHandleCache && !_folderNeedsReconnect;
  }
  return false;
}

// How long ble_scan listens before reporting what it found. Web Bluetooth
// hands the user an OS chooser that stays open until they pick; native BLE
// has no such dialog, so this is the substitute — long enough for a dive
// computer sitting in Bluetooth mode to advertise (they beacon every second
// or so), short enough not to feel hung.
const BLE_SCAN_MS = 4000;

// ── Incremental sync via device fingerprints (brief §16) ────────────────
// A full first-ever sync takes tens of minutes at real BLE speed; nobody
// waits that out routinely. libdivecomputer devices track a per-dive
// fingerprint (an opaque, device-assigned 4-byte value) — set the newest
// one we've already seen before a sync, and the device driver itself stops
// enumerating anything at-or-older than it (shearwater_petrel.c's own
// cutoff, not something reproduced here). Routine syncs become "check for
// anything newer" instead of a full re-download.
//
// Storage: localStorage keyed by the device's own serial number (the only
// thing that's actually unique per physical unit — vendor+product alone
// would collide if two people had the same model). The timing snag: the
// serial isn't known until the WASM module is already running (DC_EVENT_
// DEVINFO fires from inside dc_device_foreach, and dc_device_set_fingerprint
// must be called BEFORE dc_device_foreach even starts) — so which stored
// fingerprint to pass has to be a pre-connection guess, not a lookup keyed
// on information that doesn't exist yet. That guess is provably safe to get
// wrong: the device compares the fingerprint we send byte-for-byte against
// its own dive records, so a fingerprint belonging to a DIFFERENT physical
// device simply never matches anything — the cutoff just doesn't engage,
// and the sync silently falls back to a full download. Worst case is a
// slower sync, never wrong or lost data. So: guess by vendor+product (the
// common case — one diver, one computer — resolves correctly; the rare
// multi-identical-device case just doesn't get the speedup that session),
// then store precisely by the confirmed serial once it's known.
const BLE_FINGERPRINT_KEY = 'divelog-ble-fingerprint';

function _loadFingerprintStore() {
  try { return JSON.parse(localStorage.getItem(BLE_FINGERPRINT_KEY) || '{}'); }
  catch (e) { return {}; }
}

// Best-effort pre-connection guess: the one stored entry (if exactly one)
// whose computer label matches the family about to be paired. Declines to
// guess amid ambiguity (0 or 2+ matches) rather than picking arbitrarily —
// harmless either way, but "no fingerprint" is the more predictable default.
//
// staleness check (found via live testing, 2026-07-14): the fingerprint
// only answers "has the DEVICE recorded anything new" — it has no idea
// whether OUR copy is still intact. Delete some dives from Shoal's history
// and resync: the device correctly reports nothing new (nothing new WAS
// added there), and a fingerprint-only check would report "up to date"
// while actually missing data — wrong, silently. Fix: store the total
// local dive count alongside each fingerprint; if the count has since
// DROPPED, something was deleted (doesn't matter what, or from where —
// any deletion is worth a recheck), so decline to use the fingerprint this
// time and fall back to a full sync, which naturally re-covers everything.
// Returns { hex, recovering } rather than a bare hex so the caller can
// give an honest status message instead of a generic "downloading".
function _guessFingerprintFor(computer) {
  const store = _loadFingerprintStore();
  const matches = Object.values(store).filter((e) => e && e.computer === computer);
  if (matches.length !== 1) return { hex: null, recovering: false };
  const entry = matches[0];
  if (typeof entry.diveCountAtSync === 'number' && typeof dives !== 'undefined' && dives.length < entry.diveCountAtSync) {
    return { hex: null, recovering: true };
  }
  return { hex: entry.hex, recovering: false };
}

function _storeFingerprint(serial, hex, computer) {
  const store = _loadFingerprintStore();
  // dives.length captured HERE (after the sync's own matched/attached
  // dives have already landed — see the call site in syncFromBluetooth,
  // deliberately placed after _finishSync resolves) so the baseline
  // reflects what's actually confirmed present, not a stale pre-sync count.
  store[serial] = { hex, computer, syncedAt: new Date().toISOString(), diveCountAtSync: dives.length };
  localStorage.setItem(BLE_FINGERPRINT_KEY, JSON.stringify(store));
}

// { serial: '2521710054', computer: 'Shearwater Peregrine', syncedAt: '...' }[]
// — for populating the Settings & data "forget this computer" list.
function listSyncedBluetoothComputers() {
  const store = _loadFingerprintStore();
  return Object.entries(store).map(([serial, e]) => ({ serial, computer: e.computer, syncedAt: e.syncedAt }));
}

function forgetBluetoothSyncHistory(serial) {
  const store = _loadFingerprintStore();
  if (!(serial in store)) return false;
  delete store[serial];
  localStorage.setItem(BLE_FINGERPRINT_KEY, JSON.stringify(store));
  return true;
}

// Settings & data escape hatch — renders the synced-computer list with a
// per-entry "Forget" action. Called from app.js's unified show() patch
// whenever the Settings panel opens (CLAUDE.md: "Do not add more patches
// to show()" — this hooks the existing obsidian-panel branch, not a new one).
function _renderBleSyncHistory() {
  const box = document.getElementById('ble-sync-history-list');
  if (!box) return;
  const entries = listSyncedBluetoothComputers();
  if (!entries.length) {
    box.innerHTML = '<div class="text-muted-para">No dive computers synced yet.</div>';
    return;
  }
  entries.sort((a, b) => (b.syncedAt || '').localeCompare(a.syncedAt || ''));
  box.innerHTML = entries.map((e) => {
    const when = e.syncedAt ? new Date(e.syncedAt).toLocaleString() : 'unknown time';
    return `<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 0;border-bottom:1px solid var(--border-mid)">
      <div>
        <div>${esc(e.computer || 'Unknown computer')}</div>
        <div class="text-muted-para" style="font-size:var(--font-size-xs)">Serial ${esc(e.serial)} · last synced ${esc(when)}</div>
      </div>
      <button type="button" class="btn-ghost" data-ble-serial="${esc(e.serial)}" onclick="_forgetBleComputerClicked(this.dataset.bleSerial)">Forget</button>
    </div>`;
  }).join('');
}

function _forgetBleComputerClicked(serial) {
  forgetBluetoothSyncHistory(serial);
  _renderBleSyncHistory();
}

// Read timeout — generous vs. the real capture's sub-second response times,
// but finite so a mid-download disconnect fails the C layer's own
// DC_STATUS_TIMEOUT path instead of hanging the returned promise forever.
const BLE_READ_TIMEOUT_MS = 15000;

function _makePacketQueue() {
  const packets = [];
  let waiter = null; // { settle } for a read() currently blocked on empty queue
  let disconnected = false;

  function push(bytes) {
    if (waiter) { const w = waiter; waiter = null; w.settle(bytes); }
    else packets.push(bytes);
  }
  function fail() {
    disconnected = true;
    if (waiter) { const w = waiter; waiter = null; w.settle(new Uint8Array(0)); }
  }
  async function read(size) {
    if (packets.length) {
      const pkt = packets.shift();
      // Shouldn't happen with Shearwater/Suunto's own packet sizes, but
      // degrade honestly (hand out the remainder next call) rather than
      // silently drop bytes if a notification is ever larger than asked.
      if (pkt.length > size) { packets.unshift(pkt.subarray(size)); return pkt.subarray(0, size); }
      return pkt;
    }
    if (disconnected) return new Uint8Array(0);
    return new Promise((resolve) => {
      // The timeout timer must (a) die when this read resolves normally and
      // (b) only ever clear ITS OWN waiter. The first version of this code
      // did neither — its timer checked `if (waiter)`, i.e. ANY waiter — so
      // during a healthy paced download the FIRST read's stale timer fired
      // 15s in and nulled out whichever read was in flight at that moment,
      // orphaning its promise forever (push() then saw no waiter and just
      // queued packets; fail() saw no waiter and couldn't rescue it). That
      // froze the C engine mid-suspension: Shoal went silent, the Peregrine
      // showed "LOG ERROR: Timeout" ~20s in, and neither the disconnect
      // message nor Cancel could ever fire — the exact 2026-07-14 live-test
      // failure. Caught only when the replay mock got realistic ~60ms BLE
      // pacing; every earlier mock answered at CPU speed, so no timer ever
      // outlived its own exchange.
      const w = {
        settle(bytes) { clearTimeout(timer); resolve(bytes); },
      };
      const timer = setTimeout(() => {
        if (waiter === w) { waiter = null; resolve(new Uint8Array(0)); }
      }, BLE_READ_TIMEOUT_MS);
      waiter = w;
    });
  }
  return { push, fail, read };
}

// Discover the RX (notify) and TX (write) characteristics by GATT property
// flags rather than hardcoded UUIDs — Subsurface's own qt-ble.cpp does the
// same (no Shearwater/Suunto characteristic UUIDs are hardcoded there
// either), and it's more robust than guessing values we can't verify
// without the hardware in hand.
async function _discoverCharacteristics(service) {
  const chars = await service.getCharacteristics();
  const rx = chars.find((c) => c.properties.notify);
  const tx = chars.find((c) => c.properties.write || c.properties.writeWithoutResponse);
  if (!rx || !tx) throw new Error('Paired device\'s service has no notify+write characteristic pair');
  return { rx, tx };
}

async function _connectAndIdentify(device) {
  const server = await device.gatt.connect();
  for (const svc of BLE_SERVICES) {
    let service;
    try { service = await server.getPrimaryService(svc.uuid); }
    catch (e) { continue; } // this device doesn't expose this family's service
    return { server, service, vendor: svc.vendor, product: svc.product };
  }
  server.disconnect();
  throw new Error('Paired device exposes none of the known dive-computer services');
}

// ── Transport openers ───────────────────────────────────────────────────
// Both return the same shape, or null if the user cancelled device
// selection (not an error — no status message, no thrown exception):
//
//   { vendor, product, write(bytes), close() }
//
// and both feed `queue` one packet per received notification, calling
// onDropped() if the link dies underneath them. Nothing below this point in
// the file knows which transport it got.

async function _openWebBluetoothTransport(queue, onDropped) {
  let device;
  try {
    device = await navigator.bluetooth.requestDevice({
      filters: BLE_SERVICES.map((s) => ({ services: [s.uuid] })),
      optionalServices: BLE_SERVICES.map((s) => s.uuid),
    });
  } catch (e) {
    if (e.name === 'NotFoundError') return null; // user closed the chooser
    throw new Error(`Couldn't start pairing: ${e.message}`);
  }

  const { server, service, vendor, product } = await _connectAndIdentify(device);
  const { rx, tx } = await _discoverCharacteristics(service);

  const onNotify = (ev) => queue.push(new Uint8Array(ev.target.value.buffer));
  const onDisconnect = () => { onDropped(); queue.fail(); };
  rx.addEventListener('characteristicvaluechanged', onNotify);
  device.addEventListener('gattserverdisconnected', onDisconnect);
  await rx.startNotifications();

  return {
    vendor, product,
    write: async (bytes) => {
      if (tx.properties.writeWithoutResponse) await tx.writeValueWithoutResponse(bytes);
      else await tx.writeValue(bytes);
    },
    close: async () => {
      rx.removeEventListener('characteristicvaluechanged', onNotify);
      device.removeEventListener('gattserverdisconnected', onDisconnect);
      try { await rx.stopNotifications(); } catch (e) {}
      try { device.gatt.disconnect(); } catch (e) {}
    },
  };
}

async function _openNativeBleTransport(queue, onDropped, setStatus) {
  const { invoke, Channel } = window.__TAURI__.core;

  setStatus('Looking for your dive computer…');
  const found = await invoke('ble_scan', {
    services: BLE_SERVICES.map((s) => s.uuid),
    timeoutMs: BLE_SCAN_MS,
  });
  if (!found.length) {
    throw new Error('No dive computer found. Put it in Bluetooth mode and try again.');
  }
  const chosen = found.length === 1 ? found[0] : await _pickBleDevice(found, setStatus);
  if (!chosen) return null; // user dismissed the picker

  // A Channel, not an app.emit event: channels preserve message boundaries
  // and ordering, and one notification MUST arrive as exactly one packet
  // (the framing rule at the top of this file).
  const channel = new Channel();
  channel.onmessage = (msg) => {
    if (msg.kind === 'data') queue.push(new Uint8Array(msg.data));
    else if (msg.kind === 'closed') { onDropped(); queue.fail(); }
  };

  const conn = await invoke('ble_connect', { id: chosen.id, onPacket: channel });
  const svc = BLE_SERVICES.find((s) => s.uuid === conn.service);
  if (!svc) throw new Error('Connected device reports an unrecognised service');

  return {
    vendor: svc.vendor,
    product: svc.product,
    write: (bytes) => invoke('ble_write', { data: Array.from(bytes) }),
    close: () => invoke('ble_disconnect').catch(() => {}),
  };
}

// Native BLE has no OS chooser dialog, so when more than one dive computer
// is advertising we have to ask. Rendered inline into the existing status
// area rather than as a modal — same call this app already makes for the
// UDDF profile review list (a rarely-hit flow doesn't need overlay-stack
// and back-button integration). One diver with one computer never sees it.
function _pickBleDevice(devices, setStatus) {
  return new Promise((resolve) => {
    const statusEl = document.getElementById('lf-uddf-status');
    if (!statusEl) { resolve(devices[0]); return; }
    statusEl.style.display = '';
    statusEl.innerHTML =
      '<div style="margin-bottom:8px">Which dive computer?</div>' +
      devices.map((d, i) =>
        `<button type="button" class="btn-ghost" data-ble-pick="${i}" style="display:block;width:100%;text-align:left;margin-bottom:4px">${esc(d.name)}</button>`
      ).join('') +
      '<button type="button" class="btn-ghost" data-ble-pick="cancel">Cancel</button>';
    statusEl.querySelectorAll('[data-ble-pick]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const v = btn.getAttribute('data-ble-pick');
        statusEl.textContent = '';
        resolve(v === 'cancel' ? null : devices[+v]);
      }, { once: true });
    });
  });
}

// Assembles the WASM module's streamed JSON-line protocol (dive_start /
// waypoint / deco_event / dive_end — see download.c) into the same
// parsed-dive shape js/profile.js's UDDF path produces, so it can share
// the identical matching + landing pipeline (brief §9's whole point).
function _assembleDive(obj, cur, computer) {
  if (obj.type === 'dive_start') {
    // Gas mix classification reuses _gasMixLabel (js/profile.js) — the same
    // Air/Nitrox NN/Trimix snapping the UDDF path already does, not a second
    // implementation. download.c only ever supplies the dive's primary
    // (back/first-listed) mix, so tanksize/pstart/pend stay null here —
    // that's DC_FIELD_TANK, still deferred (see download.c's header).
    const gas = obj.o2 != null ? _gasMixLabel({ o2: obj.o2, he: obj.he }) : null;
    return {
      maxDepth: obj.maxdepth, duration: obj.divetime,
      startedAt: obj.datetime ? new Date(obj.datetime).toISOString() : null,
      waypoints: [], events: [],
      gpsLat: null, gpsLng: null, siteName: '',
      gas, tanksize: null, pstart: null, pend: null,
      computer,
    };
  }
  if (obj.type === 'waypoint' && cur) {
    const wp = { t: obj.t, d: obj.d };
    if (obj.temp != null) wp.temp = obj.temp;
    if (obj.ndl != null)  wp.ndl  = obj.ndl;
    cur.waypoints.push(wp);
  }
  // Safety/deco/deep-stop samples — download.c emits one line per sample,
  // undeduplicated, matching exactly how js/profile.js's UDDF <decostop>
  // parser already feeds events[]. Grouping into pills happens downstream
  // in renderProfileChart (js/profile.js), unchanged by this being a
  // second source of the same shape.
  if (obj.type === 'deco_event' && cur) {
    cur.events.push({ t: obj.t, type: obj.kind, depth: obj.depth });
  }
  return cur;
}

// Live-sync state, module-scoped so cancelBluetoothSync() (a separate user
// action, from the Cancel button) can reach the in-flight queue/device —
// null whenever no sync is running. `reason` distinguishes a user-requested
// cancel from the device itself dropping the connection, set BEFORE the
// disconnect is triggered in the cancel case so the gattserverdisconnected
// handler (which fires for both) doesn't overwrite it.
let _activeSync = null;

function cancelBluetoothSync() {
  if (!_activeSync || _activeSync.reason) return;
  console.debug(`[computer-sync] Cancel clicked at t+${Date.now() - _activeSync.startedAt}ms`);
  _activeSync.reason = 'cancelled';
  _activeSync.queue.fail();
  // Drop the link immediately — that's what makes Cancel stop a healthy,
  // still-responding sync rather than hoping the engine notices later.
  try { _activeSync.transport.close(); } catch (e) {}
}

function _setSyncingUI(syncing) {
  const cancelBtn = document.getElementById('lf-ble-cancel');
  if (cancelBtn) cancelBtn.style.display = syncing ? '' : 'none';
  const bar = document.getElementById('lf-ble-progress');
  if (bar && !syncing) bar.style.display = 'none';
}

function _updateSyncProgress(current, maximum, diveCount) {
  const bar = document.getElementById('lf-ble-progress');
  const track = document.getElementById('lf-ble-progress-track');
  const fill = document.getElementById('lf-ble-progress-fill');
  const label = document.getElementById('lf-ble-progress-label');
  if (!bar || !fill) return;
  bar.style.display = '';
  const pct = Math.min(100, (100 * current) / maximum);
  fill.style.width = pct.toFixed(1) + '%';
  const text = `${pct.toFixed(0)}%${diveCount ? ` · ${diveCount} dive${diveCount === 1 ? '' : 's'} so far` : ''}`;
  if (label) label.textContent = text;
  if (track) {
    track.setAttribute('aria-valuenow', pct.toFixed(0));
    // aria-valuetext carries the dive count too, same info sighted users
    // get from the visible label — a bare percentage alone would tell a
    // screen-reader user less than everyone else can already see.
    track.setAttribute('aria-valuetext', text);
  }
}

// Bumped on every behavioural change to this file, logged at sync start —
// the one-glance answer to "is the browser actually running the new code,
// or did the service worker hand it a stale cached copy?" (which is
// exactly what burned the 2026-07-14 live tests: a fix shipped without a
// sw.js cache bump never reached the already-installed SW's cache, and two
// hardware sessions were spent re-testing the old bytes).
const BLE_SYNC_REV = 11;

async function syncFromBluetooth() {
  const statusEl = document.getElementById('lf-uddf-status');
  const setStatus = (msg) => { if (statusEl) { statusEl.style.display = ''; statusEl.textContent = msg; } };
  console.info(`[computer-sync] rev ${BLE_SYNC_REV}`);

  if (!bleSyncSupported()) { setStatus('Bluetooth sync needs Chrome, Edge, or the desktop app.'); return; }

  // Checked before touching Bluetooth at all — pairing/scanning is pointless
  // if the dives it finds have nowhere to be saved. See _bleHasSyncDestination.
  if (!_bleHasSyncDestination()) {
    setStatus('Set a folder or connect Obsidian in Settings & data first — otherwise these dives would only be saved in your browser, with no way to move them into a vault afterward.');
    return;
  }

  const queue = _makePacketQueue();
  // Called for BOTH a user cancel (cancelBluetoothSync closes the link on
  // purpose) and the device dropping the connection itself — only the
  // latter should set 'disconnected' (cancel already set 'cancelled' first).
  const onDropped = () => {
    if (_activeSync && !_activeSync.reason) _activeSync.reason = 'disconnected';
  };

  let transport;
  try {
    transport = _webBluetoothSupported()
      ? await _openWebBluetoothTransport(queue, onDropped)
      : await _openNativeBleTransport(queue, onDropped, setStatus);
  } catch (e) {
    setStatus(`Connection failed: ${e.message}`);
    return;
  }
  if (!transport) return; // user backed out of device selection — not an error

  const { vendor, product } = transport;
  _activeSync = { queue, transport, reason: null, startedAt: Date.now() };
  _setSyncingUI(true);

  // Hoisted above the try (not declared inside it) so the catch block below
  // can still reach whatever was collected before things went wrong —
  // exactly what an earlier version got wrong. cancelBluetoothSync() closes
  // the link immediately (correct — it's what makes Cancel actually stop a
  // healthy, still-responding sync rather than hoping the engine notices
  // later), but the WASM engine can have a write in flight, or attempt one
  // more, in that same instant. That write then fails against a dead link,
  // which used to reject factory() and jump straight past all the
  // reason-based handling below into a generic "Sync failed: <raw GATT
  // error>" with every already-downloaded dive silently discarded.
  // Live-tested: cancel mid-sync produced exactly that message and
  // genuinely lost the dives. The write wrapper below now swallows that
  // failure outright rather than relying on this catch to sort it out —
  // see its own comment for why Asyncify made that mandatory.
  const computer = `${vendor} ${product}`;
  const parsedDives = [];
  let cur = null;
  let serial = null;          // confirmed once DC_EVENT_DEVINFO arrives
  let newestFingerprint = null; // this session's newest dive's fingerprint

  // Speculative pre-connection guess (brief §16) — safe to be wrong, see
  // the block comment above _guessFingerprintFor. Only meaningfully
  // possible on a repeat sync; a first-ever sync for this vendor/product
  // has no stored entry yet and correctly falls back to a full download.
  const { hex: fingerprintGuess, recovering } = _guessFingerprintFor(computer);
  const isIncremental = !!fingerprintGuess;

  try {
    setStatus(isIncremental
      ? `Checking ${vendor} ${product} for new dives… (Cancel if this doesn't finish)`
      : recovering
        ? `Some previously-synced dives seem to be missing from your log — doing a full check to help recover them. This can take a while; safe to stop anytime — dives already found are kept, and syncing again picks up the rest.`
        : `Downloading your full dive history from ${vendor} ${product} — this can take 30–40 min. Safe to stop anytime; dives already downloaded are kept, and syncing again picks up the rest.`);

    globalThis.dcTransport = {
      read: (size) => queue.read(size),
      // This MUST NOT reject, ever. The WASM module reaches JS through
      // EM_ASYNC_JS, and under Asyncify (the engine-agnostic suspension
      // mechanism the module switched to so it could run in the shell's
      // WKWebView at all — see vendor/libdivecomputer-wasm/README.md) a
      // rejected promise leaves the C stack suspended with nothing left to
      // resume it: main() never returns, onExit never fires, and the await
      // below hangs forever instead of failing. The old JSPI build turned
      // the same rejection into a factory() rejection, so the catch block
      // below was enough. It no longer is.
      //
      // So a failed write is converted into the condition the C engine
      // already knows how to handle: fail the queue, and its next read
      // returns empty → DC_STATUS_TIMEOUT → main() returns → onExit fires →
      // the reason-based handling below runs normally and salvages every
      // dive downloaded so far. That path is exercised on every single
      // cancel, because cancelling closes the link out from under an
      // in-flight write by design.
      write: async (bytes) => {
        try {
          await transport.write(bytes);
        } catch (e) {
          console.debug(`[computer-sync] write failed (${e && e.message}) — failing queue so the engine unwinds cleanly`);
          queue.fail();
        }
      },
    };

    // Console timeline (t+Nms from Sync tap, same t=0 the Cancel-click log
    // in cancelBluetoothSync uses — _activeSync.startedAt — so the two logs
    // correlate directly) for every non-waypoint event; waypoints are
    // excluded deliberately, hundreds per dive, pure noise. Added after a
    // live test reported "no progress bar, nothing landed" with no way to
    // tell whether that was a real bug or Cancel simply being pressed
    // before the manifest's total size (and thus the first valid progress
    // event) was even known — this makes that answerable from the console
    // instead of guessed at from memory next time.
    const elapsed = () => `t+${Date.now() - _activeSync.startedAt}ms`;
    const factory = (await import('../vendor/libdivecomputer-wasm/download.mjs')).default;
    const factoryArgs = fingerprintGuess ? [vendor, product, fingerprintGuess] : [vendor, product];

    // Awaiting factory() alone is NOT enough — it resolves the moment main()
    // first suspends, with the download still to come, so everything below
    // would run against zero dives. -sEXIT_RUNTIME=1 makes emscripten call
    // onExit(code) when main() genuinely returns; that's the real completion
    // signal. onAbort covers a WASM trap, which the old JSPI build surfaced
    // as a factory rejection and which would otherwise hang here forever.
    // (Same helper shape as scripts/libdivecomputer-wasm-spike/run-module.mjs,
    // inlined because this is a classic script and can't import an ES module.)
    let settleRun, failRun;
    const runFinished = new Promise((resolve, reject) => { settleRun = resolve; failRun = reject; });
    await factory({
      arguments: factoryArgs,
      onExit: (code) => settleRun(code),
      onAbort: (err) => failRun(new Error(`dive-computer engine aborted: ${err}`)),
      print: (line) => {
        let obj; try { obj = JSON.parse(line); } catch { return; }
        if (obj.type === 'dive_start') { cur = _assembleDive(obj, null, computer); console.debug(`[computer-sync] ${elapsed()} dive_start`, obj); }
        else if (obj.type === 'waypoint') _assembleDive(obj, cur, computer);
        else if (obj.type === 'deco_event') { _assembleDive(obj, cur, computer); console.debug(`[computer-sync] ${elapsed()} deco_event ${obj.kind}@${obj.depth}m`); }
        else if (obj.type === 'dive_end' && cur) { parsedDives.push(cur); console.debug(`[computer-sync] ${elapsed()} dive_end — ${parsedDives.length} so far`); cur = null; }
        else if (obj.type === 'progress') { console.debug(`[computer-sync] ${elapsed()} progress ${obj.current}/${obj.maximum}`); _updateSyncProgress(obj.current, obj.maximum, parsedDives.length); }
        else if (obj.type === 'devinfo') { serial = String(obj.serial); console.debug(`[computer-sync] ${elapsed()} devinfo serial=${serial} model=${obj.model} firmware=${obj.firmware}`); }
        else if (obj.type === 'newest_fingerprint') { newestFingerprint = obj.hex; console.debug(`[computer-sync] ${elapsed()} newest_fingerprint ${obj.hex}`); }
      },
    });
    await runFinished;
    console.debug(`[computer-sync] t+${Date.now() - _activeSync.startedAt}ms engine finished, reason=${_activeSync.reason}, dives collected=${parsedDives.length}`);

    // _finishSync BEFORE storing — _storeFingerprint reads dives.length as
    // the staleness baseline (see its comment), which must reflect
    // whatever THIS sync just auto-attached, not the pre-sync count.
    await _finishSync(parsedDives, computer, vendor, product, setStatus, isIncremental);

    // Persist ONLY on a genuinely clean, uninterrupted completion — a
    // fingerprint is a hard cutoff at the protocol level (the device
    // stops telling us about anything at-or-older than it), so persisting
    // one from an interrupted session would make the gap between "truly
    // known" and "session got cut off at" permanently unreachable on every
    // future sync. reason stays null for a clean finish even though the
    // engine finishing without throwing doesn't alone guarantee that (a
    // cancel or disconnect exits cleanly via the read-timeout path, and
    // since the write wrapper now swallows its own failures that is in fact
    // the ONLY way they exit) — reason is the real signal, not the absence
    // of an exception.
    if (_activeSync.reason === null && serial && newestFingerprint) {
      _storeFingerprint(serial, newestFingerprint, computer);
      console.debug(`[computer-sync] fingerprint stored for serial=${serial}: ${newestFingerprint}, baseline dive count=${dives.length}`);
    }
  } catch (e) {
    console.debug(`[computer-sync] t+${Date.now() - _activeSync.startedAt}ms engine THREW: ${e.message}, reason=${_activeSync.reason}, dives collected=${parsedDives.length}`);
    // A cancel- or disconnect-induced write failure lands here with
    // _activeSync.reason already set (set BEFORE the disconnect that
    // caused it) — treat it exactly like a clean cancel/disconnect, same
    // message, same salvage of whatever was collected. Only a reason-less
    // exception is a genuinely unexpected failure.
    if (_activeSync.reason) {
      await _finishSync(parsedDives, computer, vendor, product, setStatus, isIncremental);
    } else if (parsedDives.length) {
      setStatus(`Sync failed (${e.message}), but ${parsedDives.length} dive${parsedDives.length === 1 ? '' : 's'} came through first, reviewing those below.`);
      await _routeSyncedDives(parsedDives, computer, setStatus);
    } else {
      setStatus(`Sync failed: ${e.message}`);
    }
  } finally {
    try { await transport.close(); } catch (e) {}
    _activeSync = null;
    _setSyncingUI(false);
  }
}

// Shared by the normal completion path and the catch block above — a
// cancel/disconnect that manifests as a thrown exception (see the comment
// above syncFromBluetooth's hoisted parsedDives) must be handled identically
// to one that resolves cleanly, not treated as a different, worse outcome.
async function _finishSync(parsedDives, computer, vendor, product, setStatus, isIncremental) {
  if (_activeSync.reason === 'cancelled') {
    setStatus(parsedDives.length
      ? `Cancelled — but ${parsedDives.length} dive${parsedDives.length === 1 ? '' : 's'} came through first, reviewing those below. Sync again anytime to pick up the rest.`
      : 'Sync cancelled.');
    if (parsedDives.length) await _routeSyncedDives(parsedDives, computer, setStatus);
  } else if (_activeSync.reason === 'disconnected') {
    // Real, distinct message — the previous version's bug: this fell
    // through to _routeSyncedDives, which for zero dives says "No dives
    // on this computer" — true words, false implication (a healthy
    // computer that's actually empty, not a connection that just died).
    if (parsedDives.length) {
      setStatus(`Connection dropped partway through, but ${parsedDives.length} dive${parsedDives.length === 1 ? '' : 's'} came through first, reviewing those below. Reconnect to get the rest.`);
      await _routeSyncedDives(parsedDives, computer, setStatus);
    } else {
      setStatus(`Connection to your ${vendor} ${product} was lost before any dives came through — check it's still on and try again.`);
    }
  } else if (isIncremental && !parsedDives.length) {
    // _routeSyncedDives's zero-dives message ("No dives on this computer.")
    // is correct wording for a full sync but actively misleading here — an
    // incremental check finding nothing new is the ROUTINE, EXPECTED, GOOD
    // outcome (you're already up to date), not a "this computer is empty"
    // report. Handled here rather than inside _routeSyncedDives itself
    // since that function is shared with UDDF import, where "incremental"
    // isn't a concept that applies at all.
    setStatus(`Already up to date — no new dives on your ${vendor} ${product} since last sync.`);
  } else {
    await _routeSyncedDives(parsedDives, computer, setStatus);
  }
}

// Same match → attach/review/new-candidates routing importUddfForNewDive
// uses (js/profile.js), reused rather than duplicated — BLE sync is meant
// to land in the identical review list and bulk-add bar UDDF import
// already has (brief §9).
async function _routeSyncedDives(parsedDives, sourceLabel, setStatus) {
  if (!parsedDives.length) { setStatus('No dives on this computer.'); return; }

  let attached = 0;
  const claimed = new Set();
  const newCandidates = [];
  for (const parsed of parsedDives) {
    const { auto, ranked } = matchToLoggedDive(parsed, dives, claimed);
    if (auto) {
      claimed.add(auto.id);
      if ((await _attachProfile(auto, parsed, sourceLabel)) === 'ok') attached++;
    } else if (ranked.length) {
      _pendingProfileReview.push({ parsed, ranked: ranked.slice(0, 3), sourceLabel });
    } else {
      newCandidates.push({ parsed, sourceLabel });
    }
  }

  _renderProfileReviewList();
  if (newCandidates.length === 1) {
    const { gpsSet, siteName } = _prefillLogFormFromProfile(newCandidates[0].parsed, newCandidates[0].sourceLabel);
    const gpsBit = gpsSet ? ` — dropped the pin${siteName ? ' near "' + siteName + '"' : ''}` : '';
    setStatus(`Pre-filled below${gpsBit} — add the site, buddy and any sightings, then save.`);
  } else if (newCandidates.length > 1) {
    _pendingNewDiveCandidates = newCandidates;
    _renderNewDivePicker();
    setStatus(`${newCandidates.length} new dives found — "Add all" below, or pick one to log fully now.`);
  } else {
    setStatus(`${attached} already logged — profile${attached === 1 ? '' : 's'} attached.`);
  }
}

// Reveal the Sync button only where BLE genuinely works. Two ways it can:
// Web Bluetooth in the browser (Chrome/Edge only — not Brave, which
// disables it by default like File System Access; not Firefox/Safari/iOS at
// all), or the native transport in the Tauri shell. Import (the sibling
// button in the same card) has no such gate — it always shows.
//
// The web check runs synchronously, not on DOMContentLoaded — this script
// tag sits at the end of <body>, so the DOM (including #lf-ble-sync-btn)
// already exists by the time this line executes; DOMContentLoaded would
// likely have already fired by then and the listener would never run.
// Clearing (not setting) the inline style.display lets the button's own CSS
// rule (display:flex, for the icon+label layout) take over, rather than
// fighting it with an inline 'block'/'' mismatch.
//
// The shell check can't be synchronous — it asks the OS whether a Bluetooth
// adapter is actually available, so a Mac with Bluetooth switched off hides
// the button rather than offering it and failing on tap. isShell() alone
// would have been the easy gate and the wrong one.
function _revealBleSyncButton() {
  const btn = document.getElementById('lf-ble-sync-btn');
  if (btn) btn.style.display = '';
}

if (_webBluetoothSupported()) {
  _revealBleSyncButton();
} else if (typeof isShell === 'function' && isShell()) {
  window.__TAURI__.core.invoke('ble_available')
    .then((ok) => { if (ok) { _nativeBleReady = true; _revealBleSyncButton(); } })
    .catch(() => {});
}
