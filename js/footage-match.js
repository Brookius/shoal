// Auto-match footage to dives by capture time.
//
// The manual flow (footage modal → drag files in) assumes every file you drop
// belongs to the dive whose modal is open. That's fine if your footage is
// already sorted per-dive, and a wall if you come back from a trip with 200
// clips in one folder. This reads each video's own capture timestamp and works
// out which dive it belongs to.
//
// Scope, deliberately: this ASSIGNS videos to dives inside the app. It never
// creates, moves, renames or writes anything in the source folder. Physically
// organising footage into per-dive folders is a real follow-up, but it's hard
// to undo, so the matching earns trust first.
//
// No Rust needed: <input webkitdirectory> hands us the whole tree as File
// objects in both Chromium and WebKit, so this works identically in the
// browser build and the Tauri shell's WKWebView.

// Seconds between 1904-01-01 (the ISO-BMFF/QuickTime epoch) and 1970-01-01.
const FMAT_EPOCH_1904_OFFSET = 2082844800;
// Padding either side of a dive's window. Symmetric and deliberately tight —
// dive video is shot in the water and recording starts within a few minutes of
// the descent, unlike topside photos (which is why Submersion's photo matcher
// uses a much wider asymmetric window; see BRIEF-footage-cloud-hosting.md §3.4).
// Tight padding also all but removes the overlapping-window case, since surface
// intervals run far longer than 20 minutes.
const FMAT_PAD_MS = 10 * 60 * 1000;
// Used only when a dive has an entry time but no duration at all.
const FMAT_ASSUMED_DIVE_MIN = 60;

let _fmatItems  = [];   // [{ file, name, relPath, ms, source }]
let _fmatResult = null; // last _fmatMatchAll() output
let _fmatOffset = 0;    // whole hours applied to every capture time

// ── Capture time ─────────────────────────────────────────────────────────

// Timestamps outside this range mean "the camera's clock was never set" —
// an unset clock writes 1904 or 1970 — so they're treated as absent, not as
// a real (wildly wrong) capture time that would poison matching.
function _fmatPlausible(ms) {
  return Number.isFinite(ms) && ms > 946684800000 && ms < Date.now() + 86400000;
}

// A file the capture-time reader can pull bytes out of, without caring where
// it came from. Two implementations, because the two platforms hand us
// different things once the folder was chosen through a NATIVE picker:
//   browser — a real File (File System Access), sliced directly
//   shell   — only an absolute path, so bytes come back over IPC
// Both are lazy: a box-table walk reads ~16 bytes per box, never the file.
function _fmatSourceFor(entry) {
  const base = { name: entry.name, relPath: entry.relPath, size: entry.size, modified: entry.modified };
  if (entry.file) {
    return { ...base, slice: (s, e) => entry.file.slice(s, e).arrayBuffer() };
  }
  return {
    ...base,
    slice: async (s, e) => {
      const bytes = await window.__TAURI__.core.invoke('read_file_range', {
        path: entry.path, offset: s, len: e - s,
      });
      return new Uint8Array(bytes).buffer;
    },
  };
}

// Walk sibling ISO-BMFF boxes in [from, to) looking for `wantType`.
//   [uint32 size][4-char type]   size === 1 → real 64-bit size follows
//                                size === 0 → box runs to `to`
// Each step reads only 16 bytes, so this walks a multi-gigabyte file's box
// table without loading any of its content.
async function _fmatFindBox(file, wantType, from, to) {
  let pos = from;
  while (pos + 8 <= to) {
    let head;
    try {
      head = new DataView(await file.slice(pos, Math.min(pos + 16, to)));
    } catch (e) { return null; }
    if (head.byteLength < 8) return null;

    let size = head.getUint32(0);
    const type = String.fromCharCode(head.getUint8(4), head.getUint8(5), head.getUint8(6), head.getUint8(7));
    let headerLen = 8;
    if (size === 1) {
      if (head.byteLength < 16) return null;
      size = Number(head.getBigUint64(8));
      headerLen = 16;
    } else if (size === 0) {
      size = to - pos;
    }
    if (size < headerLen) return null; // malformed — stop rather than loop forever
    if (type === wantType) return { dataStart: pos + headerLen, end: pos + size };
    pos += size;
  }
  return null;
}

// The video's own recorded start-of-recording time, from the container's
// `moov > mvhd` box. Walking the box tree (rather than reading a fixed prefix)
// is what makes this work on GoPro footage at all — GoPro and plenty of other
// cameras put `moov` at the END of the file, so a "read the first 64KB"
// approach misses it on exactly the hardware this feature is for.
//
// Falls back to the filesystem mtime, which is what the existing per-dive
// ingest already stores — but only as a fallback, since many copy/transfer
// tools reset it to "now", silently destroying the real capture time.
async function _fmatReadCaptureTime(file) {
  try {
    const moov = await _fmatFindBox(file, 'moov', 0, file.size);
    if (moov) {
      const mvhd = await _fmatFindBox(file, 'mvhd', moov.dataStart, moov.end);
      if (mvhd) {
        const buf = await file.slice(mvhd.dataStart, Math.min(mvhd.dataStart + 20, file.size));
        const dv = new DataView(buf);
        // mvhd payload: version(1) flags(3) creation_time(4 or 8) …
        if (dv.byteLength >= 12) {
          const version = dv.getUint8(0);
          const secs = version === 1 ? Number(dv.getBigUint64(4)) : dv.getUint32(4);
          const raw = new Date((secs - FMAT_EPOCH_1904_OFFSET) * 1000);
          // Read as WALL CLOCK, not as a UTC instant. The spec says mvhd is
          // UTC, but action cameras overwhelmingly write whatever local time
          // they were set to — which is precisely the case worth optimising
          // for: "camera set to local time before getting in the water" should
          // need no correction at all.
          //
          // It also makes the result independent of where the app is being
          // run. Treating it as a UTC instant would compare against a
          // local-wall-clock dive window, so reviewing Indonesian footage from
          // the UK would match differently than reviewing it in Indonesia —
          // the same footage and the same dives giving two different answers.
          // A genuinely UTC-writing camera lands a whole number of hours out
          // instead, which is exactly what the offset control is for.
          const ms = new Date(
            raw.getUTCFullYear(), raw.getUTCMonth(), raw.getUTCDate(),
            raw.getUTCHours(), raw.getUTCMinutes(), raw.getUTCSeconds()
          ).getTime();
          if (_fmatPlausible(ms)) return { ms, source: 'container' };
        }
      }
    }
  } catch (e) {
    // Malformed/truncated container — fall through to mtime rather than fail
    // the whole batch for one bad file.
  }
  // mtime is a true instant, so unlike the container path above it IS
  // viewer-timezone-dependent. Left as-is: it's already the flagged, less
  // trustworthy source (the preview labels it "file date, not camera"), and
  // re-interpreting it would be inventing precision it doesn't have.
  return _fmatPlausible(file.modified)
    ? { ms: file.modified, source: 'modified' }
    : null;
}

// ── Dive windows ─────────────────────────────────────────────────────────

// 'YYYY-MM-DD' + 'HH:MM' → a LOCAL Date. Local is correct and deliberate:
// dive entry/exit times are local wall-clock with no timezone recorded, and a
// camera set to local time before getting in the water writes local wall-clock
// too — so the two line up directly with no conversion.
function _fmatLocalDate(dateStr, timeStr) {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr || '');
  const tm = /^(\d{1,2}):(\d{2})/.exec(timeStr || '');
  if (!dm || !tm) return null;
  const d = new Date(+dm[1], +dm[2] - 1, +dm[3], +tm[1], +tm[2], 0, 0);
  return isNaN(d.getTime()) ? null : d;
}

// The answer to "what if the dive has no entry/exit time" — a fallback chain,
// degrading honestly rather than guessing silently:
//   1. entry + exit          → exact window
//   2. entry + bottom time   → derive exit
//   3. entry only            → assume a nominal dive length, FLAGGED
//   4. date only             → can't be time-matched; date-only suggestion
//   5. no date               → unmatchable
function _fmatDiveWindow(dive) {
  if (!dive.date) return { kind: 'none' };
  if (!dive.entrytime) return { kind: 'dateOnly' };

  const start = _fmatLocalDate(dive.date, dive.entrytime);
  if (!start) return { kind: 'dateOnly' };

  let endMs = null;
  if (dive.exittime) {
    const e = _fmatLocalDate(dive.date, dive.exittime);
    // Exit before entry means the dive crossed midnight — same wrap the
    // form's own calcExitTime() handles.
    if (e) endMs = e.getTime() < start.getTime() ? e.getTime() + 86400000 : e.getTime();
  }
  let assumed = false;
  if (endMs == null) {
    const mins = parseFloat(dive.time);
    if (Number.isFinite(mins) && mins > 0) {
      endMs = start.getTime() + mins * 60000;
    } else {
      endMs = start.getTime() + FMAT_ASSUMED_DIVE_MIN * 60000;
      assumed = true;
    }
  }
  return { kind: 'timed', startMs: start.getTime(), endMs, assumed };
}

// ── Matching ─────────────────────────────────────────────────────────────

function _fmatMatchAll(items, offsetHours) {
  const offMs = (offsetHours || 0) * 3600000;
  const timed = [];
  const dateOnly = [];
  let noDate = 0;

  for (const d of dives) {
    const w = _fmatDiveWindow(d);
    if (w.kind === 'timed')         timed.push({ dive: d, ...w });
    else if (w.kind === 'dateOnly') dateOnly.push({ dive: d });
    else                            noDate++;
  }

  const matched = [];    // { item, dive, ambiguous, assumed }
  const suggested = [];  // { item, dive } — date-only, needs confirmation
  const unmatched = [];

  for (const item of items) {
    const t = item.ms + offMs;
    const hits = timed.filter(w => t >= w.startMs - FMAT_PAD_MS && t <= w.endMs + FMAT_PAD_MS);
    if (hits.length === 1) {
      matched.push({ item, dive: hits[0].dive, ambiguous: false, assumed: hits[0].assumed });
      continue;
    }
    if (hits.length > 1) {
      // Overlapping padded windows (back-to-back dives). Nearest entry wins,
      // but say so rather than presenting it as certain.
      hits.sort((a, b) => Math.abs(t - a.startMs) - Math.abs(t - b.startMs));
      matched.push({ item, dive: hits[0].dive, ambiguous: true, assumed: hits[0].assumed });
      continue;
    }
    // No timed window — fall back to a same-calendar-day dive that has a date
    // but no entry time. Offered as a SUGGESTION only, never auto-assigned:
    // mirrors the UDDF import's split between auto-attach on a clear winner
    // and a review list for anything ambiguous (js/profile.js).
    const day = _fmatDayKey(t);
    const dayHits = dateOnly.filter(w => w.dive.date === day);
    if (dayHits.length === 1) suggested.push({ item, dive: dayHits[0].dive });
    else unmatched.push(item);
  }

  return { matched, suggested, unmatched, skipped: { noDate, dateOnly: dateOnly.length } };
}

function _fmatDayKey(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Offset detection is a RESCUE, not the primary mechanism — see the comment on
// _fmatLocalDate for why the normal case needs no correction at all. Only run
// when most videos matched nothing, and only ever as a suggestion the user
// accepts; never applied silently.
function _fmatSuggestOffset(items) {
  let best = null;
  for (let h = -12; h <= 14; h++) {
    if (h === 0) continue;
    const r = _fmatMatchAll(items, h);
    const score = r.matched.length;
    // Tie-break toward the smaller absolute shift.
    if (score > 0 && (!best || score > best.score || (score === best.score && Math.abs(h) < Math.abs(best.hours)))) {
      best = { hours: h, score };
    }
  }
  return best;
}

// ── Flow ─────────────────────────────────────────────────────────────────

function _fmatStatus(msg) {
  const el = document.getElementById('footage-match-status');
  // Reset color: _showFmSyncStatus (js/footage.js) borrows this element as a
  // fallback and sets an inline red/green — without resetting it here, a
  // later plain status line would silently inherit that leftover color.
  if (el) { el.style.display = ''; el.style.color = ''; el.textContent = msg; }
}

// Matching runs against the SAME connected video folder playback resolves
// from (js/video.js — _proxyEntries), rather than a separate one-off picker.
// That's deliberate: a folder picked only for matching gave no playable
// source, so matched videos showed up in the footage modal as filenames with
// nothing behind them. One connected folder means a matched video is playable
// immediately and stays playable across restarts, because the connection is
// already persisted (a path in the shell, an IndexedDB handle in the browser).
async function matchFootageToDives() {
  // ALWAYS open the picker. An earlier version skipped it whenever a folder
  // was already connected and silently re-scanned that one instead, which made
  // it impossible to point the button at a different trip — the whole job of
  // this button is "match the footage in THIS folder". connectProxyFolder()
  // adds the pick to the connected set (deduped) and re-scans; cancelling it
  // is a no-op, which is what makes the fallback below safe.
  _fmatStatus('Choose the folder your dive videos are in…');
  await connectProxyFolder();

  // Cancelling the picker leaves the previous scan intact, so a mis-click
  // falls back to whatever was already connected rather than dead-ending.
  const scanned = (typeof _proxyEntries !== 'undefined' ? _proxyEntries : []);
  // Proxies are excluded on purpose: an ffmpeg re-encode stamps the new file's
  // mvhd with the ENCODE time, so matching off one would file every dive on
  // the day the proxies were generated. Originals only.
  const originals = scanned.filter(e => !e.isProxy);
  if (!originals.length) {
    _fmatStatus(scanned.length
      ? 'That folder only contains proxy re-encodes — pick the folder with your original footage.'
      : 'No videos found. Pick a folder that contains your dive footage (subfolders are searched too).');
    return;
  }

  _fmatStatus(`Reading capture times from ${originals.length} video${originals.length === 1 ? '' : 's'}…`);
  _fmatItems = [];
  let noTime = 0;
  for (const entry of originals) {
    const src = _fmatSourceFor(entry);
    const t = await _fmatReadCaptureTime(src);
    if (!t) { noTime++; continue; }
    _fmatItems.push({
      name: entry.name, relPath: entry.relPath,
      size: entry.size, modified: entry.modified,
      ms: t.ms, source: t.source,
    });
  }

  if (!_fmatItems.length) {
    _fmatStatus(`Couldn't read a capture time from any of those ${vids.length} videos — nothing to match on.`);
    return;
  }

  _fmatOffset = 0;
  _fmatResult = _fmatMatchAll(_fmatItems, 0);

  // Only reach for an offset when the result is clearly bad — most videos
  // landing nowhere is the signal, not a few strays.
  let hint = '';
  if (_fmatResult.matched.length < _fmatItems.length / 2) {
    const s = _fmatSuggestOffset(_fmatItems);
    if (s && s.score > _fmatResult.matched.length) {
      hint = `Most of these didn't land on a dive. They look about ${s.hours > 0 ? '+' : ''}${s.hours}h off your dive times — `
           + `<button type="button" class="btn-ghost" onclick="applyFootageMatchOffset(${s.hours})">try ${s.hours > 0 ? '+' : ''}${s.hours}h</button>`;
    }
  }

  const skippedBits = [];
  if (noTime) skippedBits.push(`${noTime} video${noTime === 1 ? '' : 's'} had no readable capture time`);
  _fmatStatus(skippedBits.length ? skippedBits.join('; ') + '.' : '');
  _renderFootageMatchPreview(hint);
}

function applyFootageMatchOffset(hours) {
  _fmatOffset = hours;
  _fmatResult = _fmatMatchAll(_fmatItems, hours);
  _renderFootageMatchPreview('');
}

function _fmatOffsetInputChanged(el) {
  const v = parseInt(el.value, 10);
  applyFootageMatchOffset(Number.isFinite(v) ? v : 0);
}

// ── Preview ──────────────────────────────────────────────────────────────

function _renderFootageMatchPreview(hintHtml) {
  const box = document.getElementById('footage-match-review');
  if (!box) return;
  if (!_fmatResult) { box.innerHTML = ''; box.style.display = 'none'; return; }
  box.style.display = '';

  const { matched, suggested, unmatched, skipped } = _fmatResult;

  // Group confident matches by dive so the user reads it as "this dive got
  // these clips", which is the decision they're actually confirming.
  const byDive = new Map();
  for (const m of matched) {
    if (!byDive.has(m.dive.id)) byDive.set(m.dive.id, { dive: m.dive, rows: [] });
    byDive.get(m.dive.id).rows.push(m);
  }

  const diveLabel = (d) => `#${d.divenum || '?'} — ${esc(d.site || 'Unknown site')} · ${esc(d.date || '')}`;
  const timeOf = (item) => {
    const d = new Date(item.ms + _fmatOffset * 3600000);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };
  const row = (m) => {
    const flags = [];
    if (m.ambiguous) flags.push('closest of several');
    if (m.assumed)   flags.push('dive length assumed');
    if (m.item.source === 'modified') flags.push('file date, not camera');
    return `<div style="display:flex;gap:8px;align-items:baseline;padding:2px 0">
      <span style="font-family:var(--mono);font-size:var(--font-size-xs);color:var(--text-muted)">${timeOf(m.item)}</span>
      <span style="flex:1">${esc(m.item.name)}</span>
      ${flags.length ? `<span style="font-size:var(--font-size-xs);color:var(--warn)">${esc(flags.join(' · '))}</span>` : ''}
    </div>`;
  };

  const diveCards = [...byDive.values()].map(g => `<div class="info-box" style="margin-bottom:10px">
    <div style="margin-bottom:6px"><strong>${diveLabel(g.dive)}</strong> — ${g.rows.length} video${g.rows.length === 1 ? '' : 's'}</div>
    ${g.rows.map(row).join('')}
  </div>`).join('');

  const suggestHtml = suggested.length ? `<div class="info-box" style="margin-bottom:10px">
    <div style="margin-bottom:6px"><strong>Same day, but no dive time to check against</strong> — confirm each one yourself</div>
    ${suggested.map((s, i) => `<div style="display:flex;gap:8px;align-items:center;padding:3px 0">
      <span style="flex:1">${esc(s.item.name)} → ${diveLabel(s.dive)}</span>
      <button type="button" class="btn-ghost" onclick="acceptFootageMatchSuggestion(${i})">Accept</button>
    </div>`).join('')}
  </div>` : '';

  const unmatchedHtml = unmatched.length ? `<div class="info-box" style="margin-bottom:10px">
    <div style="margin-bottom:4px"><strong>${unmatched.length} video${unmatched.length === 1 ? '' : 's'} didn't match any dive</strong></div>
    <div class="text-muted-para" style="font-size:var(--font-size-xs)">${unmatched.slice(0, 12).map(u => esc(u.name)).join(', ')}${unmatched.length > 12 ? `, +${unmatched.length - 12} more` : ''}</div>
  </div>` : '';

  // Say plainly which dives couldn't take part. A silent partial match is the
  // failure mode worth avoiding — "nothing else belonged to a dive" and "the
  // app couldn't tell" must not look the same.
  const skipBits = [];
  if (skipped.dateOnly) skipBits.push(`${skipped.dateOnly} dive${skipped.dateOnly === 1 ? '' : 's'} had no entry time`);
  if (skipped.noDate)   skipBits.push(`${skipped.noDate} had no date`);
  const skipHtml = skipBits.length
    ? `<div class="text-muted-para" style="font-size:var(--font-size-xs);margin-bottom:10px">${esc(skipBits.join(', '))} — those couldn't be time-matched.</div>`
    : '';

  const offsetHtml = `<div style="display:flex;gap:8px;align-items:center;margin-bottom:10px;flex-wrap:wrap">
    <label for="footage-match-offset" class="form-label">Camera clock offset</label>
    <input type="number" id="footage-match-offset" step="1" value="${_fmatOffset}" style="width:70px" onchange="_fmatOffsetInputChanged(this)">
    <span class="text-muted-para" style="font-size:var(--font-size-xs)">hours</span>
  </div>`;

  const confirmHtml = matched.length
    ? `<button type="button" class="btn-ghost" style="font-weight:600" onclick="confirmFootageMatch()">Link ${matched.length} video${matched.length === 1 ? '' : 's'} to ${byDive.size} dive${byDive.size === 1 ? '' : 's'} →</button>`
    : '<div class="text-muted-para">Nothing to link yet — try adjusting the offset above.</div>';

  box.innerHTML = (hintHtml ? `<div class="info-box" style="margin-bottom:10px">${hintHtml}</div>` : '')
    + offsetHtml + skipHtml + diveCards + suggestHtml + unmatchedHtml + confirmHtml;
}

// A date-only suggestion, promoted to a real match by explicit user action.
function acceptFootageMatchSuggestion(i) {
  if (!_fmatResult) return;
  const s = _fmatResult.suggested[i];
  if (!s) return;
  _fmatResult.suggested.splice(i, 1);
  _fmatResult.matched.push({ item: s.item, dive: s.dive, ambiguous: false, assumed: false });
  _renderFootageMatchPreview('');
}

// ── Assign ───────────────────────────────────────────────────────────────

// Writes the same videos[] entry shape _processFootageFiles (js/footage.js)
// already produces, so everything downstream — the footage modal, the sidecar,
// proxy matching — sees no difference between a video linked here and one
// dragged into a dive by hand.
async function confirmFootageMatch() {
  if (!_fmatResult || !_fmatResult.matched.length) return;

  const byDive = new Map();
  for (const m of _fmatResult.matched) {
    if (!byDive.has(m.dive.id)) byDive.set(m.dive.id, { dive: m.dive, items: [] });
    byDive.get(m.dive.id).items.push(m.item);
  }

  _fmatStatus(`Linking to ${byDive.size} dive${byDive.size === 1 ? '' : 's'}…`);
  let added = 0;

  for (const { dive, items } of byDive.values()) {
    if (!dive.videos) dive.videos = [];
    const existing = new Set(dive.videos.map(v => v.file));
    for (const it of items) {
      if (existing.has(it.name)) continue;
      // `path` is the root-qualified relative path (v2.982) and is what
      // playback resolves on; `file` stays the bare name because it is the
      // join key clips, dedup, the reviewed toggle and the DOM all use, and
      // the label shown in the video list. See _resolveLocalUrl (js/video.js).
      dive.videos.push({ file: it.name, path: it.relPath || undefined,
                         modified: it.modified, size: it.size, reviewed: false });
      existing.add(it.name);
      added++;
    }
    dive.videos.sort((a, b) => a.modified - b.modified);
    dive._pendingSync = true;
  }
  localStorage.setItem('divelog-dives', JSON.stringify(dives));

  // Sequential, not parallel — same SAF write-storm caution already documented
  // on _applyTripToDiveList (js/history.js) and _bulkAddNewDives (js/profile.js).
  for (const { dive } of byDive.values()) {
    try { await _fmPush(dive); } catch (e) { /* stays _pendingSync */ }
  }

  _fmatItems = [];
  _fmatResult = null;
  const box = document.getElementById('footage-match-review');
  if (box) { box.innerHTML = ''; box.style.display = 'none'; }
  _fmatStatus(`Linked ${added} video${added === 1 ? '' : 's'} across ${byDive.size} dive${byDive.size === 1 ? '' : 's'}. Open a dive's footage to tag species in them.`);
  if (typeof renderHistory === 'function') renderHistory();
}
