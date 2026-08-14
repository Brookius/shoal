// Footage modal (v2.1, multi-clip + per-clip notes).
// Classic script — loaded after app.js. All functions are global.
// Phase 3: open/close, render videos list, reviewed toggle.
// Phase 4: inline "+ sighting from this video" form per video card.
// Phase 5: multi-clip support — each sighting can have multiple clips;
//           per-clip notes distinguish individual animals.

let _footageDiveId  = null;
let _footageMobTab  = 'videos';

// ── Player state (v2.35) ───────────────────────────────────────────────────────
let _activeVideoFile = null; // filename of the video loaded in the player
let _videoEl         = null; // <video> DOM reference
let _playerPaused    = true;
let _duration        = 0;    // loaded video duration in seconds
let _scrubMouseDown  = false;

// ── Tag-mode state (v2.36) ────────────────────────────────────────────────────
let _rightTagActive = false; // true while ＋ Tag here picker is open
let _openWithPanelPinned = false; // pin the side panel once it's rendered
let _tagSpecies     = null;  // selected species object in tag form
let _tagAbundance   = '';    // 'R'|'O'|'C' in tag form
let _tagEditKey     = null;  // speciesKey being inline-edited (null = none)
let _tagEditIdx     = null;  // clip index being inline-edited
let _tagEditAb      = '';    // abundance in inline edit
let _tagEditNewSpecies = null; // replacement species chosen via "Change animal…"
// Species narrowing for the tag picker, derived from THIS dive's country when
// the modal opens (v2.982) — the same idea as the log form's Country
// pre-filter, but with its own state so the two can't overwrite each other.
// See speciesRegionsForCountry() in js/species.js. null = showing everything.
let _tagRegionFilter = null;

// ── Watch-mode state (v2.37) ─────────────────────────────────────────────────
let _watchMode        = false; // true when Watch right column is active
let _watchExpandedKey = null;  // species key expanded in Watch list
let _watchPendingSecs = null;  // seek target after a video-switch in Watch

// ── Species picker column state ────────────────────────────────────────────────
let _footagePickerOpen  = false;  // true while right column shows the species browser
let _footagePickerTab   = 'Shark'; // active browse-tab when no query is typed
let _pickerFullList     = [];     // full species list for the current browse tab
let _pickerBatchCount   = 60;     // how many cells are currently rendered
let _pickerObs          = null;   // IntersectionObserver for infinite-scroll sentinel

// ── Sync status feedback ───────────────────────────────────────────────────────
// _fmPush is shared by every caller that mutates dive.videos/clips, including
// footage-match.js's Settings-panel auto-match flow — which never has the
// footage modal open, so #fm-sync-status doesn't exist in the DOM at that
// point. Falling back to #footage-match-status means a write failure during
// auto-match is no longer silently dropped (found 2026-07-26: matched videos
// played fine from the in-memory dive.videos array regardless of whether the
// backend write succeeded, so a failed push had no visible symptom at all
// except a "not synced" banner with no explanation).
let _fmSyncTimer = null;
function _showFmSyncStatus(msg, isError) {
  const el = document.getElementById('fm-sync-status') || document.getElementById('footage-match-status');
  if (!el) return;
  el.textContent = msg;
  el.style.display = 'block';
  el.style.color = isError ? 'var(--danger)' : 'var(--success)';
  clearTimeout(_fmSyncTimer);
  _fmSyncTimer = setTimeout(() => { el.style.display = 'none'; }, isError ? 6000 : 3000);
}

async function _fmPush(dive) {
  if (syncMode === 'folder') {
    // Sidecar FIRST, verified — writeToFolder strips clips from the MD, so it
    // only runs once the sidecar is confirmed on disk. On 'fail' the folder MD
    // stays untouched; the change is safe in localStorage.
    const sc = await writeSidecar(dive);
    if (sc === 'fail') {
      _showFmSyncStatus('Sidecar not saved — grant folder access via Data → Sync from folder', true);
      return;
    }
    writeToFolder(dive)
      .then(ok => {
        if (!ok) _showFmSyncStatus('Folder write failed — change kept locally, will retry from Settings', true);
      })
      .catch(e => {
        console.error('[footage] folder write error:', e);
        _showFmSyncStatus('Folder write failed — change kept locally, will retry from Settings', true);
      });
    return;
  }
  if (syncMode !== 'obsidian') {
    console.log('[footage] syncMode is', syncMode, '— skipping push (local-only)');
    return;
  }

  // A never-pushed dive has no filename — push the MD once to mint it
  // (that MD has no legacy clips to lose; it doesn't exist in the vault yet).
  if (!dive._filename) {
    const first = await pushToObsidian(dive).catch(() => null);
    if (!first || !first.ok) {
      dive._pendingSync = true;
      localStorage.setItem('divelog-dives', JSON.stringify(dives));
      _showFmSyncStatus('Obsidian not reachable — change saved locally, will sync on next reload', true);
      return;
    }
  }

  // Sidecar FIRST, verified. The MD writer strips clips/videos (v2.33+), so
  // rewriting the MD before the sidecar is confirmed on disk can destroy the
  // only copy of legacy footage. On 'fail' the vault MD stays untouched —
  // the change is safe in localStorage with _pendingSync set.
  const sc = await writeSidecar(dive);
  if (sc === 'fail') {
    dive._pendingSync = true;
    localStorage.setItem('divelog-dives', JSON.stringify(dives));
    _showFmSyncStatus('Sidecar not saved — change kept locally, will sync on next reload', true);
    return;
  }

  console.log('[footage] pushing dive', dive._filename, 'marine:', JSON.stringify(dive.marine));
  pushToObsidian(dive)
    .then(r => {
      console.log('[footage] push result:', r ? r.status : 'null', 'file:', r ? r.filename : '?');
      if (r && r.ok) {
        _showFmSyncStatus('✓ Saved to Obsidian (' + (r.filename || '?') + ')', false);
      } else if (r) {
        _showFmSyncStatus('Obsidian sync failed (HTTP ' + r.status + ') — check API key and vault folder', true);
      }
    })
    .catch(e => {
      console.error('[footage] push error:', e);
      _showFmSyncStatus('Obsidian not reachable — change saved locally, will sync on next reload', true);
    });
}

// ── Open / close ──────────────────────────────────────────────────────────────

function openFootage(diveId, opts) {
  // Footage is the Tauri-app-only video workspace (it authors + watches, and proxies
  // need the macOS encoder). The web build — mobile and desktop browser — never opens it.
  if (!isShell()) return;
  // Desktop-only — footage player not supported below 900 px (within the app)
  if (window.innerWidth < 900) return;

  // A species-profile modal's own ▶ clip link calls openFootage() directly
  // with no idea another overlay might already be open — closing it here
  // mirrors goToDiveFromSpecies()'s existing lateral-navigation pattern
  // (album.js). Without this, both overlays end up open at once: the
  // species profile's own close button then pops whatever's actually on
  // top of _openOverlays (now footage, pushed after it), not itself, so it
  // looks like clicking its X does nothing. Scoped to speciesProfile only —
  // a dive-file overlay is left alone, since its own 🎬 button intentionally
  // opens footage ON TOP of it and returns there when footage closes.
  const _topOverlay = _openOverlays[_openOverlays.length - 1];
  if (_topOverlay && _topOverlay.type === 'speciesProfile') {
    _openOverlays.pop();
    closeSpeciesProfileDirect();
  }

  const d = dives.find(d => d.id === diveId);
  if (!d) return;
  _footageDiveId = diveId;

  // Pre-filter the tag picker to species recorded near where this dive was.
  // Reset per open, so switching dives can't inherit the previous one's country.
  const _tagRegions = (typeof speciesRegionsForCountry === 'function')
    ? speciesRegionsForCountry(d.location || '') : null;
  _tagRegionFilter = _tagRegions ? { country: d.location, regions: _tagRegions } : null;

  // Reset player state
  _cleanupPlayer();
  _activeVideoFile  = null;
  _scrubMouseDown   = false;
  _watchPendingSecs = null;

  // Mode from call site (🎬 → Tag, ▶ on species → Watch)
  _watchMode        = !!(opts && opts.mode === 'watch');
  _watchExpandedKey = (opts && opts.expandKey) || null;
  // Arriving via a species' ▶ (album / dive file) means the point of the
  // visit is that ONE sighting — which lives in the panel. Opening with it
  // parked off-screen would hide the very thing that was clicked, so this
  // entry pins the panel; a plain 🎬 open leaves it tucked away.
  _openWithPanelPinned = !!_watchExpandedKey;

  // ▶ entry: open on the animal's first clip — its video, cued to its timestamp
  // (not the first video in the dive's list)
  if (_watchMode && _watchExpandedKey) {
    const mm = (d.marine || []).find(m =>
      (m.scientificName || m.customId || '') === _watchExpandedKey);
    const clips = mm ? _sightingClips(mm).filter(c => c.video) : [];
    if (clips.length) {
      _activeVideoFile = clips[0].video;
      const s = _tsToSeconds(clips[0].time || '');
      if (s !== null) _watchPendingSecs = s;
    }
  }

  // Reset tag form state
  _rightTagActive = false;
  _tagSpecies     = null;
  _tagAbundance   = '';
  _tagEditKey     = null;
  _tagEditIdx     = null;
  _tagEditAb      = '';

  // Reset legacy form state
  _footageMobTab              = 'videos';
  _footagePickerOpen          = false;
  _footageFormVidFile         = null;
  _footageFormSpecies         = null;
  _footageFormAbundance       = '';
  _footageAttachingStampName  = null;
  _footageEditingStampName    = null;
  _footageEditingStampClipIdx = null;
  _footageEditNote            = '';

  // Header context line
  const dateStr = d.date ? (() => {
    const dt = new Date(d.date + 'T12:00');
    return dt.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  })() : '';
  document.getElementById('fm-ctx').textContent = [
    d.divenum ? '#' + d.divenum : '',
    d.site,
    d.region,
    dateStr,
  ].filter(Boolean).join('  ·  ');

  _renderFootageBody(d);
  _pushOverlayState({ type: 'footage', diveId });
  document.getElementById('footage-modal').classList.add('open');
  _lockScroll();

  // Keyboard transport — remove-then-add so repeat opens never stack listeners
  window.removeEventListener('keydown', _onFootageKeydown);
  window.addEventListener('keydown', _onFootageKeydown);

  // Restore the proxies folder (silent if permission persisted; 'stored'
  // surfaces the Reconnect button). Re-render only if the state changed.
  const proxyBefore = proxyStatus().state;
  restoreProxyFolder().then(state => {
    if (state !== proxyBefore && _footageDiveId === diveId) _renderFootageBody(d);
  });
}

function closeFootage() {
  closeTopOverlay();
}

function closeFootageDirect() {
  _cleanupPlayer();
  window.removeEventListener('keydown', _onFootageKeydown);
  _activeVideoFile = null;
  _rightTagActive   = false;
  _tagSpecies       = null;
  _tagAbundance     = '';
  _tagEditKey       = null;
  _tagEditIdx       = null;
  _tagEditAb        = '';
  _tagEditNewSpecies = null;
  _watchMode        = false;
  _watchExpandedKey = null;
  _watchPendingSecs = null;
  _footageFormVidFile = null;
  _footagePickerOpen  = false;
  _disconnectPickerObs();
  cancelMobilePicker();
  document.getElementById('footage-modal').classList.remove('open');
  _unlockScroll();
  _footageDiveId = null;
}

function handleFootageOverlayClick(e) {
  if (e.target === document.getElementById('footage-modal')) closeFootage();
}

// ── Mobile tab switcher ────────────────────────────────────────────────────────
// Switches the Videos/Sightings split view on narrow screens via a class on
// .fm-split (CSS shows/hides each half — see @media max-width:600px).
// Pure DOM update — no re-render needed.
// The .fm-mob-tab querySelectorAll this used to also update here is gone
// (2026-08-04): no markup anywhere ever creates an element with that class
// — dead code from the pre-2026-07-25 three-column footage layout, so the
// loop was a guaranteed no-op. Confirmed via a fresh grep, not assumed from
// an earlier note. The .fm-split toggle below is the only part that ever
// did anything.
function switchFootageTab(tab) {
  _footageMobTab = tab;
  const split = document.querySelector('#footage-modal .fm-split');
  if (split) {
    split.classList.remove('tab-videos', 'tab-sightings');
    split.classList.add('tab-' + tab);
  }
}

// ── Render ─────────────────────────────────────────────────────────────────────

function _renderFootageBody(d) {
  // Preserve video list scroll across re-renders (toggling reviewed, adding videos, etc.)
  const vidScroll    = document.querySelector('#footage-modal .dm-videos-scroll');
  const vidScrollTop = vidScroll ? vidScroll.scrollTop : 0;

  // Watch mode: the animal list is the same content across re-renders — keep
  // its scroll too (clip taps on another video re-render the whole body)
  const rScroll    = _watchMode ? document.querySelector('#footage-modal .dm-right-scroll') : null;
  const rScrollTop = rScroll ? rScroll.scrollTop : 0;

  document.getElementById('footage-body').innerHTML = _footageBodyHtml(d);

  // Applied here rather than in openFootage because the panel doesn't exist
  // until this line runs. One-shot: consumed so a later re-render doesn't
  // keep forcing open a panel the user has since dismissed.
  if (_openWithPanelPinned) {
    pinWatchSightings();
    _openWithPanelPinned = false;
  }

  const newVidScroll = document.querySelector('#footage-modal .dm-videos-scroll');
  if (newVidScroll && vidScrollTop) newVidScroll.scrollTop = vidScrollTop;

  const newRScroll = _watchMode ? document.querySelector('#footage-modal .dm-right-scroll') : null;
  if (newRScroll && rScrollTop) newRScroll.scrollTop = rScrollTop;

  _initPlayer(d);
}

function _footageBodyHtml(d) {
  const allVideos = d.videos || [];

  // Sort: unreviewed first, reviewed last — alphabetical within each group
  const sortedVideos = allVideos.slice().sort((a, b) => {
    if (a.reviewed !== b.reviewed) return a.reviewed ? 1 : -1;
    return a.file.localeCompare(b.file);
  });

  // Default active file to first if unset or video was deleted
  if (!_activeVideoFile || !allVideos.find(v => v.file === _activeVideoFile)) {
    _activeVideoFile = sortedVideos.length ? sortedVideos[0].file : null;
  }

  const activeVid = _activeVideoFile ? allVideos.find(v => v.file === _activeVideoFile) : null;
  const unrev     = allVideos.filter(v => !v.reviewed).length;

  // ── Video list (renders into the right-hand stack, below sightings) ───────
  const videoRows = sortedVideos.map(v => {
    const isActive  = v.file === _activeVideoFile;
    const tagCount  = (d.marine || []).reduce((n, m) =>
      n + _sightingClips(m).filter(c => c.video === v.file).length, 0);
    const sub       = v.reviewed
      ? (tagCount ? tagCount + ' tagged' : 'reviewed')
      : (tagCount ? tagCount + ' tagged · unreviewed' : 'not reviewed');
    const fileEsc   = esc(v.file);
    const fileJs    = v.file.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    return '<div class="vrow' + (isActive ? ' active' : '') + '"'
      + ' onclick="switchToVideo(\'' + esc(fileJs) + '\')">'
      + '<span class="vdot ' + (v.reviewed ? 'done' : 'todo') + '"></span>'
      + '<div class="vmeta">'
      + '<div class="vfn" title="' + fileEsc + '">' + fileEsc + '</div>'
      + '<div class="vsub">' + sub + '</div>'
      + '</div>'
      + '<button class="vrow-del" data-did="' + d.id + '" data-file="' + fileEsc + '"'
      + ' onclick="event.stopPropagation();deleteFootageVideo(+this.dataset.did,this.dataset.file)"'
      + ' title="Remove this video">✕</button>'
      + '</div>';
  }).join('');

  const videosPanel = '<div class="dm-videos">'
    + '<div class="dm-videos-h">Videos <span class="n">'
    + (unrev ? unrev + ' left' : 'all done') + '</span></div>'
    + '<div class="dm-videos-scroll">'
    + (videoRows || '<div style="padding:16px;font-family:var(--mono);font-size:var(--font-size-xs);color:var(--text-dim)">No videos added yet.</div>')
    + '</div>'
    // The two controls below look alike but do genuinely different jobs, and
    // the old labels ("＋ Add videos…" / "🎞 120 videos · + folder") didn't
    // say which was which: the first chooses WHICH FILES belong to this dive,
    // the second tells Shoal WHERE ON DISK to find them so they'll actually
    // play. The count in the second is the connected folder's total, not this
    // dive's — which read as a contradiction next to a 5-video list. Titles
    // spell out the relationship between the two.
    + '<div class="dm-videos-foot">'
    + '<label title="Choose which video files belong to this dive. They play once the folder holding them is connected below.">'
    + '＋ Add videos to this dive…'
    + '<input type="file" multiple accept="video/*" style="display:none"'
    + ' onchange="importFootageFiles(event,' + d.id + ')"></label>'
    + _proxyRowHtml()
    + '</div>'
    + '</div>';

  // ── Main column: player + scrubber + transport ────────────────────────────
  const isReviewed  = !!(activeVid && activeVid.reviewed);
  const fileEscDisp = activeVid ? esc(activeVid.file) : '';
  const fileAttrQ   = activeVid ? esc(activeVid.file) : '';
  const noVid       = !activeVid;
  const dis         = noVid ? ' disabled' : '';

  const centerCol = '<div class="dm-center">'
    + '<div class="vstage" id="fm-vstage">'
    + (activeVid ? '<span class="vname" id="fm-vname">' + fileEscDisp + '</span>' : '')
    + (activeVid
        ? '<video id="fm-video-el" preload="metadata" style="background:#000"></video>'
        : '<div class="vstage-empty">No video selected</div>')
    + '<span class="live-time" id="fm-live-time">0:00</span>'
    + '</div>'
    + '<div class="scrub" id="fm-scrub">'
    + '<div class="scrub-track" id="fm-scrub-track">'
    + '<div class="scrub-played" id="fm-scrub-played" style="width:0%"></div>'
    + '<div class="scrub-head"   id="fm-scrub-head"   style="left:0%"></div>'
    + '</div>'
    + '<div class="scrub-times">'
    + '<span id="fm-cur-label">0:00</span><span id="fm-dur-label">0:00</span>'
    + '</div></div>'
    + _transportHtml(d, activeVid, noVid)
    + '</div>';

  // ── Right stack, top: sightings / tag mode (v2.36) ─────────────────────────
  const rightCol = _rightColHtml(d);

  // Two columns now, not three: the player on the left, and a right-hand
  // stack of sightings (top, ~3/4) over the video list (bottom, ~1/4), each
  // scrolling independently. The video list used to be its own narrow left
  // column, which cost horizontal room the player wanted and put the two
  // things you alternate between — species and videos — at opposite edges.
  // The tab is only visible in watch mode (CSS-gated). It sits in the gutter
  // the slid-out panel leaves behind, so hovering it and hovering the panel
  // are one continuous region — no dead gap to cross with the mouse.
  const sightingCount = (d.marine || []).length;
  // Starts false unconditionally — pinned is a transient interaction state,
  // not data that should survive a fresh render of this template, and the
  // three functions that change it (_syncSideTabAria) keep it accurate from
  // the first real toggle onward.
  const sideTab = '<button class="dm-side-tab" aria-expanded="false" onclick="toggleWatchSightings()"'
    + ' title="Sightings — hover to peek, click to keep open (click again to close)">'
    // Two glyphs, CSS-swapped on .pinned: a list when closed, a
    // collapse-chevron when held open, so the same control visibly answers
    // both "where are my sightings" and "give me the video back".
    + '<svg class="tab-open" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="18" height="18">'
    + '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>'
    + '<svg class="tab-close" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="18" height="18">'
    + '<path d="M13 18l6-6-6-6M5 18l6-6-6-6"/></svg>'
    + '<span class="dm-side-tab-n" id="fm-side-tab-n">' + sightingCount + '</span>'
    + '</button>';

  return '<div class="dm-grid' + (_watchMode ? ' watch-on' : '') + '">'
    + centerCol
    + '<div class="dm-side" onmouseleave="this.classList.remove(\'dismissed\')">'
    + sideTab + rightCol + videosPanel + '</div>'
    + '</div>';
}

// ── Sightings panel (right column) ────────────────────────────────────────────

function _sightingsPanelHtml(d, sortedVideos) {
  const marine = d.marine || [];
  if (!marine.length) {
    return '<div class="fm-col-empty">No sightings logged for this dive.</div>';
  }

  return marine.map(m => {
    const name       = m.commonName || m.scientificName;
    const sciEncoded = esc(m.scientificName);
    const emoji      = GROUP_EMOJI[m.group] || '🐟';
    const clips      = _sightingClips(m);
    const hasClips   = clips.length > 0;

    const abBadge = m.abundance
      ? `<span class="sp-card-ab">${esc(m.abundance)}</span>`
      : '';

    const cardHead = `
      <div class="sp-card-head">
        <span class="sp-card-icon">${emoji}</span>
        <span class="sp-card-nm" title="${esc(name)}">${esc(name)}</span>
        ${abBadge}
      </div>`;

    // Attach-form state — show inline within card
    if (_footageAttachingStampName === m.scientificName) {
      const vidOpts = sortedVideos
        .map(v => `<option value="${esc(v.file)}">${esc(v.file)}</option>`)
        .join('');
      return `<div class="sp-card unlinked">
        ${cardHead}
        <div class="sp-card-clips">
          <div class="fm-attach-form">
            <select class="af-input fm-attach-sel" id="footage-attach-vid">${vidOpts}</select>
            <input class="af-input af-ts" id="footage-attach-ts"
                   type="text" placeholder="mm:ss" autocomplete="off">
            <input class="af-input af-note" id="footage-attach-note"
                   type="text" placeholder='note — e.g. "large male"' autocomplete="off">
            <div style="display:flex;gap:6px;margin-top:6px;">
              <button class="fm-btn primary"
                      data-did="${d.id}" data-sci="${sciEncoded}"
                      onclick="saveFootageAttach(+this.dataset.did, this.dataset.sci)">Link</button>
              <button class="fm-btn" onclick="cancelFootageAttachForm()">Cancel</button>
            </div>
          </div>
        </div>
      </div>`;
    }

    // Clips list
    if (hasClips) {
      const clipsHtml = clips.map((c, ci) => `
        <div class="sp-clip-wrap">
          <div class="sp-clip">
            <span class="f" title="${esc(c.video)}">${esc(c.video)}</span>
            ${c.time ? `<span class="t">${esc(c.time)}</span>` : ''}
          </div>
          ${c.note ? `<div class="sp-clip-note">${esc(c.note)}</div>` : ''}
        </div>`).join('');
      return `<div class="sp-card">
        ${cardHead}
        <div class="sp-card-clips">${clipsHtml}</div>
      </div>`;
    }

    // No clips — link button
    return `<div class="sp-card unlinked">
      ${cardHead}
      <button class="sp-card-link" data-sci="${sciEncoded}"
              onclick="openFootageAttachForm(this.dataset.sci)">＋ Link to video…</button>
    </div>`;
  }).join('');
}

// ── Video card (left column) ───────────────────────────────────────────────────

function _videoCardHtml(v, d) {
  // Collect all clips that reference this video, with sighting + clip index
  const stampTuples = [];
  (d.marine || []).forEach(m => {
    _sightingClips(m).forEach((c, ci) => {
      if (c.video === v.file) stampTuples.push({ m, c, ci });
    });
  });
  // Sort by timestamp; clips with no timestamp sort to bottom
  stampTuples.sort((a, b) => (a.c.time || 'zz').localeCompare(b.c.time || 'zz'));

  const stampsHtml = stampTuples.length
    ? `<div class="vid-stamps">${stampTuples.map(({ m, c, ci }) => {
        const sciEncoded = esc(m.scientificName);
        if (_footageEditingStampName === m.scientificName && _footageEditingStampClipIdx === ci) {
          // Inline edit form — same layout as the add-sighting form
          const abHtml = ['R','O','C'].map(ab =>
            `<span data-eab="${ab}" class="${_footageEditAbundance === ab ? 'on' : ''}"
                   onmousedown="event.preventDefault();setFootageEditAbundance('${ab}')">${ab}</span>`
          ).join('');
          return `<div class="add-form">
            <div class="af-sp-title">${esc(m.commonName || m.scientificName)}</div>
            <div class="af-row">
              <label class="af-lbl">Timestamp</label>
              <input class="af-input af-ts" id="footage-edit-ts" type="text"
                     value="${esc(c.time || '')}" placeholder="mm:ss" autocomplete="off">
            </div>
            <div class="af-row">
              <label class="af-lbl">Abundance</label>
              <div class="af-ab af-ab-sm">${abHtml}</div>
            </div>
            <div class="af-row">
              <label class="af-lbl">Note</label>
              <input class="af-input af-note" id="footage-edit-note" type="text"
                     placeholder="optional"
                     value="${esc(_footageEditNote || '')}" autocomplete="off">
            </div>
            <div class="af-actions">
              <button class="fm-btn" onclick="cancelFootageStampEdit()">Cancel</button>
              <button class="fm-btn primary"
                      data-did="${d.id}" data-sci="${sciEncoded}" data-cidx="${ci}"
                      onclick="saveFootageStampEdit(+this.dataset.did,this.dataset.sci,+this.dataset.cidx)">Save</button>
            </div>
          </div>`;
        }
        return `<div class="vid-stamp-wrap">
          <div class="vid-stamp">
            <span class="t">${c.time || '—'}</span>
            <span class="nm">${esc(m.commonName || m.scientificName)}</span>
            ${m.abundance ? `<span class="vid-stamp-ab">${esc(m.abundance)}</span>` : ''}
            <div class="vid-stamp-acts">
              <button class="vid-stamp-btn"
                      data-did="${d.id}" data-sci="${sciEncoded}" data-cidx="${ci}"
                      onclick="editFootageStamp(+this.dataset.did,this.dataset.sci,+this.dataset.cidx)"
                      title="Edit">✏</button>
              <button class="vid-stamp-btn danger"
                      data-did="${d.id}" data-sci="${sciEncoded}" data-cidx="${ci}"
                      onclick="unlinkFootageStamp(+this.dataset.did,this.dataset.sci,+this.dataset.cidx)"
                      title="Remove link">✕</button>
            </div>
          </div>
          ${c.note ? `<div class="vid-stamp-note">${esc(c.note)}</div>` : ''}
        </div>`;
      }).join('')}</div>`
    : `<div class="vid-empty">No sightings linked yet${v.reviewed ? '.' : ' — review pending.'}</div>`;

  const isFormOpen = (_footageFormVidFile === v.file);
  const bottomArea = isFormOpen
    ? _addFormHtml(d.id)
    : `<button class="vid-add" data-file="${esc(v.file)}"
               onclick="openFootageAddForm(this.dataset.file)">+ sighting from this video</button>`;

  return `
    <div class="vid">
      <div class="vid-head">
        <span class="vid-icon">🎬</span>
        <span class="vid-name" title="${esc(v.file)}">${esc(v.file)}</span>
        <button class="vid-state vid-toggle ${v.reviewed ? 'done' : 'pending'}"
                data-did="${d.id}" data-file="${esc(v.file)}"
                onclick="toggleFootageReviewed(+this.dataset.did, this.dataset.file)"
                title="Click to toggle reviewed state">
          ${v.reviewed ? '✓ reviewed' : '● unreviewed'}
        </button>
        <button class="vid-del"
                data-did="${d.id}" data-file="${esc(v.file)}"
                onclick="deleteFootageVideo(+this.dataset.did, this.dataset.file)"
                title="Remove this video">✕</button>
      </div>
      ${stampsHtml}
      ${bottomArea}
    </div>`;
}

// ── Inline add-sighting form + stamp edit + attach ────────────────────────────

let _footageAttachingStampName  = null; // scientificName of unlinked sighting being attached

let _footageEditingStampName    = null; // scientificName of stamp being inline-edited
let _footageEditingStampClipIdx = null; // clip index within sighting.clips[] being edited
let _footageEditAbundance       = '';   // abundance value in the stamp-edit form
let _footageEditNote            = '';   // note value in the stamp-edit form

let _footageFormVidFile    = null;  // filename of video card with open form (null = none)
let _footageFormSpecies    = null;  // { scientificName, commonName, aphiaId, group, validated }
let _footageFormAbundance  = '';    // 'R' | 'O' | 'C' | ''

function _addFormHtml(diveId) {
  const abHtml = ['R', 'O', 'C'].map(ab =>
    `<span data-ab="${ab}" class="${_footageFormAbundance === ab ? 'on' : ''}"
           onmousedown="event.preventDefault();setFootageAbundance('${ab}')">${ab}</span>`
  ).join('');

  return `
    <div class="add-form">
      <div class="af-row">
        <label class="af-lbl">Timestamp</label>
        <input class="af-input af-ts" id="footage-ts-input" type="text"
               placeholder="mm:ss" autocomplete="off">
      </div>
      <div class="af-row">
        <label class="af-lbl">Species</label>
        <div class="af-sp-pair">
          <input class="af-input" id="footage-sp-input" type="text"
                 placeholder="Type to search…" autocomplete="off"
                 oninput="onFootageSpeciesInput()"
                 onfocus="onFootageSpeciesFocus()"
                 onkeydown="onFootageSpeciesKeydown(event)"
                 onblur="setTimeout(onFootageSpeciesBlur, 150)">
          <button class="fmp-free-btn"
                  onmousedown="event.preventDefault();_footageFreeText()">+ Free text</button>
        </div>
      </div>
      <div class="af-row">
        <label class="af-lbl">Abundance</label>
        <div class="af-ab">${abHtml}</div>
      </div>
      <div class="af-row">
        <label class="af-lbl">Note</label>
        <input class="af-input af-note" id="footage-note-input" type="text"
               placeholder='optional — e.g. "pair", "juvenile"' autocomplete="off">
      </div>
      <div class="af-actions">
        <button class="fm-btn" onmousedown="cancelFootageAddForm()">Cancel</button>
        <button class="fm-btn primary" onclick="saveFootageSighting(${diveId})">Save sighting</button>
      </div>
    </div>`;
}

function openFootageAddForm(filename) {
  if (_footageFormVidFile === filename) { cancelFootageAddForm(); return; }
  _footageFormVidFile   = filename;
  _footageFormSpecies   = null;
  _footageFormAbundance = '';
  const dive = dives.find(d => d.id === _footageDiveId);
  if (dive) _renderFootageBody(dive);
}

function cancelFootageAddForm() {
  _footageFormVidFile = null;
  _footagePickerOpen  = false;
  cancelMobilePicker();
  const dive = dives.find(d => d.id === _footageDiveId);
  if (dive) _renderFootageBody(dive);
}

// ── Species picker column ─────────────────────────────────────────────────────
// The right column transforms into a photo-grid species browser when the
// species input is focused. No floating dropdown — avoids overflow-clip issues.

function onFootageSpeciesFocus() {
  _footagePickerOpen = true;
  if (window.innerWidth <= 600) {
    // Mobile: open the full-screen overlay instead of transforming the right column
    _showMobilePicker();
    return;
  }
  const dive = dives.find(d => d.id === _footageDiveId);
  if (dive) _updatePickerColumn(dive);
}

function onFootageSpeciesInput() {
  _footagePickerOpen = true;
  const dive = dives.find(d => d.id === _footageDiveId);
  if (dive) _updatePickerColumn(dive);
}

function onFootageSpeciesBlur() {
  if (window.innerWidth <= 600) return; // mobile overlay handles its own lifecycle
  _footagePickerOpen = false;
  const dive = dives.find(d => d.id === _footageDiveId);
  if (!dive) return;
  _updatePickerColumn(dive);
}

function onFootageSpeciesKeydown(e) {
  if (e.key === 'Escape') {
    e.preventDefault();
    _footagePickerOpen = false;
    const input = document.getElementById('footage-sp-input');
    if (input) input.blur();
  }
}

// Called via onmousedown on a grid cell — preventDefault keeps input focused
// long enough to fire, then blur fires naturally after.
function _footagePickSpecies(el) {
  const sci    = el.dataset.sci    || '';
  const common = el.dataset.common || '';
  const aphia  = el.dataset.aphia  ? +el.dataset.aphia : null;
  const group  = el.dataset.group  || '';
  _footageFormSpecies = { scientificName: sci, commonName: common,
                          aphiaId: aphia, group, validated: true };
  const input = document.getElementById('footage-sp-input');
  if (input) input.value = common || sci;
  _footagePickerOpen = false;

  // Mobile: close the full-screen overlay and return to the videos tab (where the form is)
  const mob = document.getElementById('footage-mob-picker');
  if (mob && mob.style.display !== 'none') {
    cancelMobilePicker();
    return;
  }

  // Desktop: restore right column to sightings list
  const dive = dives.find(d => d.id === _footageDiveId);
  if (dive) _updatePickerColumn(dive);
}

// Switch the browse-mode tab inside the picker (onmousedown to avoid blur)
function setFootagePickerTab(group) {
  _footagePickerTab = group;

  // Mobile: re-render picker overlay with new tab (clears search, scrolls to top)
  const mob = document.getElementById('footage-mob-picker');
  if (mob && mob.style.display !== 'none') {
    _disconnectPickerObs();
    mob.innerHTML = _mobilePickerHtml(''); // empty query = browse mode
    const resultsEl = mob.querySelector('.fmp-results');
    if (resultsEl) resultsEl.scrollTop = 0;
    if (_pickerFullList.length > _pickerBatchCount) _watchPickerSentinel();
    return;
  }

  // Desktop: update right column
  const dive = dives.find(d => d.id === _footageDiveId);
  if (dive) _updatePickerColumn(dive);
}

// ── Partial right-column update (leaves left column + input untouched) ─────────

function _disconnectPickerObs() {
  if (_pickerObs) { _pickerObs.disconnect(); _pickerObs = null; }
}

function _updatePickerColumn(d) {
  const rightCol = document.querySelector('#footage-modal .fm-col-right');
  if (!rightCol) return;

  _disconnectPickerObs();

  if (_footagePickerOpen) {
    const q = (document.getElementById('footage-sp-input')?.value || '').trim();
    rightCol.innerHTML = _pickerColHtml(q);
    // Set up IntersectionObserver after DOM is written if more items remain
    if (_pickerFullList.length > _pickerBatchCount) _watchPickerSentinel();
  } else {
    // Restore normal sightings list
    const marine    = d.marine   || [];
    const allVideos = d.videos   || [];
    const linked    = marine.filter(m => _sightingClips(m).length > 0).length;
    const spStats   = [
      marine.length + ' species',
      marine.length && linked === marine.length ? 'all linked'
        : (linked ? linked + ' linked' : ''),
    ].filter(Boolean).join(' · ');
    const sortedVids = allVideos.slice().sort((a, b) => {
      if (a.reviewed !== b.reviewed) return a.reviewed ? 1 : -1;
      return a.file.localeCompare(b.file);
    });
    rightCol.innerHTML = `
      <div class="fm-col-head">Sightings <span class="fm-sec-n">${spStats}</span></div>
      <div class="fm-col-scroll">${_sightingsPanelHtml(d, sortedVids)}</div>`;
  }
}

// ── Picker column HTML ─────────────────────────────────────────────────────────

// Shared cell builder — used by both initial render and infinite-scroll appender
function _pickerCellHtml(r) {
  const sciAttr = r.scientificName.replace(/&/g,'&amp;').replace(/"/g,'&quot;');
  const comAttr = (r.commonName || '').replace(/&/g,'&amp;').replace(/"/g,'&quot;');
  const grpAttr = (r.group || '').replace(/"/g,'&quot;');
  const comHtml = (r.commonName || r.scientificName)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const sciHtml = r.scientificName
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  // Upgrade square → medium (500 px) — correct for retina at ~230 px CSS width
  const photoUrl = r.photoUrl
    ? r.photoUrl.replace('/square.','/medium.').replace('square.','medium.')
    : '';
  const imgHtml = photoUrl
    ? `<img src="${photoUrl}" alt="" loading="lazy">`
    : `<div class="sp-cell-ph-grid">${GROUP_EMOJI[r.group] || '🐟'}</div>`;
  const iucnHtml = r.iucnStatus ? iucnBadge(r.iucnStatus) : '';
  return `<div class="sp-cell-2col"
    data-sci="${sciAttr}" data-common="${comAttr}"
    data-aphia="${r.aphiaId || ''}" data-group="${grpAttr}"
    onmousedown="event.preventDefault();_footagePickSpecies(this)">
    ${imgHtml}
    <div class="sp-cell-info">
      <div class="sp-cell-name">${comHtml}</div>
      <div class="sp-cell-sci">${sciHtml}</div>
      ${iucnHtml ? `<div class="sp-cell-badge">${iucnHtml}</div>` : ''}
    </div>
  </div>`;
}

function _pickerColHtml(q) {
  // Reset batch state on every fresh render
  _disconnectPickerObs();
  _pickerBatchCount = 60;
  _pickerFullList   = [];

  const isSearch = q.length >= 2;
  let visibleResults;

  if (isSearch) {
    // Search: cross-group, max 8 results — no batching needed
    visibleResults = searchLocalSpecies(q);
  } else {
    // Browse: all species in active tab, alphabetical; batch to 60 initially
    _pickerFullList = SPECIES_DB
      .filter(s => s[3] === _footagePickerTab)
      .map(s => ({ commonName: s[0], scientificName: s[1], aphiaId: s[2],
                   group: s[3], photoUrl: s[4] || '', iucnStatus: s[5] || '' }))
      .sort((a, b) => a.commonName.localeCompare(b.commonName));
    visibleResults = _pickerFullList.slice(0, _pickerBatchCount);
  }

  const hasMore    = _pickerFullList.length > _pickerBatchCount;
  const cellsHtml  = visibleResults.map(_pickerCellHtml).join('');
  // Sentinel: 1-px invisible row that triggers the IntersectionObserver
  const sentinelHtml = hasMore
    ? '<div id="sp-load-sentinel" class="sp-load-sentinel"></div>' : '';

  const headerCtx = isSearch
    ? `"${esc(q)}" &mdash; ${visibleResults.length} result${visibleResults.length !== 1 ? 's' : ''}`
    : `${_footagePickerTab}s &mdash; ${_pickerFullList.length} species`;

  const tabsHtml = !isSearch ? `
    <div class="sp-picker-tabs" role="tablist">${
      BROWSE_GROUPS.map(g =>
        `<div class="sp-picker-tab${g === _footagePickerTab ? ' active' : ''}" role="tab" aria-selected="${g === _footagePickerTab}" tabindex="0"
              onmousedown="event.preventDefault();setFootagePickerTab('${g}')"
              onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();setFootagePickerTab('${g}')}">
           ${GROUP_EMOJI[g] || ''} ${g}
           <span class="tab-count">${_groupCounts[g] || 0}</span>
         </div>`
      ).join('')
    }</div>` : '';

  return `
    <div class="fm-col-head">Pick species <span class="fm-sec-n">${headerCtx}</span></div>
    ${tabsHtml}
    <div class="fm-col-scroll" style="padding:0">
      <div class="sp-grid-2col">
        ${cellsHtml || '<div class="sp-grid-empty">No results</div>'}
        ${sentinelHtml}
      </div>
    </div>`;
}

// ── Infinite-scroll sentinel (IntersectionObserver) ────────────────────────────

function _watchPickerSentinel() {
  const mob      = document.getElementById('footage-mob-picker');
  const isMobile = mob && mob.style.display !== 'none';

  const sentinelId = isMobile ? 'sp-mob-sentinel' : 'sp-load-sentinel';
  const sentinel   = document.getElementById(sentinelId);
  const scrollEl   = isMobile
    ? mob.querySelector('.fmp-results')
    : document.querySelector('#footage-modal .fm-col-right .fm-col-scroll');
  if (!sentinel || !scrollEl) return;

  _pickerObs = new IntersectionObserver(entries => {
    if (!entries[0].isIntersecting) return;
    _disconnectPickerObs();
    _appendPickerBatch();
  }, { root: scrollEl, threshold: 0 });
  _pickerObs.observe(sentinel);
}

function _appendPickerBatch() {
  const mob      = document.getElementById('footage-mob-picker');
  const isMobile = mob && mob.style.display !== 'none';

  const sentinelId  = isMobile ? 'sp-mob-sentinel' : 'sp-load-sentinel';
  const oldSentinel = document.getElementById(sentinelId);
  const grid = isMobile
    ? mob.querySelector('.sp-grid-1col')
    : document.querySelector('#footage-modal .fm-col-right .sp-grid-2col');
  if (!grid) return;
  if (oldSentinel) oldSentinel.remove();

  const nextBatch = _pickerFullList.slice(_pickerBatchCount, _pickerBatchCount + 60);
  _pickerBatchCount += 60;

  // Append new cells directly — no re-render, scroll position preserved
  const cellFn = isMobile ? _pickerCell1ColHtml : _pickerCellHtml;
  nextBatch.forEach(r => {
    grid.insertAdjacentHTML('beforeend', cellFn(r));
  });

  // Add a new sentinel if more items still remain
  if (_pickerFullList.length > _pickerBatchCount) {
    grid.insertAdjacentHTML('beforeend',
      `<div id="${sentinelId}" class="sp-load-sentinel"></div>`);
    _watchPickerSentinel();
  }
}

// ── Mobile species picker overlay ─────────────────────────────────────────────
// Full-screen fixed overlay appended to document.body. Structure (top → bottom):
//   .fmp-results  — scrollable full-width photo grid (flex: 1)
//   .fmp-tabs     — horizontal category tabs (thumb-reachable)
//   .fmp-search-row — search input (auto-focused)
//   .fmp-footer   — FOOTAGE tag + context + ✕ (very bottom, near thumb)
// Only shown on narrow screens (≤600px); JS-gated in onFootageSpeciesFocus.

// Single-column cell — full width photos, same data-* API as _pickerCellHtml
function _pickerCell1ColHtml(r) {
  const sciAttr = r.scientificName.replace(/&/g,'&amp;').replace(/"/g,'&quot;');
  const comAttr = (r.commonName || '').replace(/&/g,'&amp;').replace(/"/g,'&quot;');
  const grpAttr = (r.group || '').replace(/"/g,'&quot;');
  const comHtml = (r.commonName || r.scientificName)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const sciHtml = r.scientificName
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const photoUrl = r.photoUrl
    ? r.photoUrl.replace('/square.','/medium.').replace('square.','medium.')
    : '';
  const imgHtml = photoUrl
    ? `<img src="${photoUrl}" alt="" loading="lazy">`
    : `<div class="sp-cell-ph-mob">${GROUP_EMOJI[r.group] || '🐟'}</div>`;
  const iucnHtml = r.iucnStatus ? iucnBadge(r.iucnStatus) : '';
  return `<div class="sp-cell-1col"
    data-sci="${sciAttr}" data-common="${comAttr}"
    data-aphia="${r.aphiaId || ''}" data-group="${grpAttr}"
    onmousedown="event.preventDefault();_footagePickSpecies(this)">
    ${imgHtml}
    <div class="sp-cell-info">
      <div class="sp-cell-name">${comHtml}</div>
      <div class="sp-cell-sci">${sciHtml}</div>
      ${iucnHtml ? `<div class="sp-cell-badge">${iucnHtml}</div>` : ''}
    </div>
  </div>`;
}

// Build the inner HTML of the mobile overlay. Caller must call _disconnectPickerObs()
// first. Resets _pickerBatchCount and _pickerFullList as a side-effect.
function _mobilePickerHtml(q) {
  _pickerBatchCount = 60;
  _pickerFullList   = [];

  const isSearch = q.length >= 2;
  let visibleResults;

  if (isSearch) {
    visibleResults = searchLocalSpecies(q);
  } else {
    _pickerFullList = SPECIES_DB
      .filter(s => s[3] === _footagePickerTab)
      .map(s => ({ commonName: s[0], scientificName: s[1], aphiaId: s[2],
                   group: s[3], photoUrl: s[4] || '', iucnStatus: s[5] || '' }))
      .sort((a, b) => a.commonName.localeCompare(b.commonName));
    visibleResults = _pickerFullList.slice(0, _pickerBatchCount);
  }

  const hasMore      = _pickerFullList.length > _pickerBatchCount;
  const cellsHtml    = visibleResults.map(_pickerCell1ColHtml).join('');
  const sentinelHtml = hasMore
    ? '<div id="sp-mob-sentinel" class="sp-load-sentinel"></div>' : '';

  const tabsHtml = BROWSE_GROUPS.map(g =>
    `<div class="sp-picker-tab${g === _footagePickerTab ? ' active' : ''}" role="tab" aria-selected="${g === _footagePickerTab}" tabindex="0"
          onmousedown="event.preventDefault();setFootagePickerTab('${g}')"
          onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();setFootagePickerTab('${g}')}">
       ${GROUP_EMOJI[g] || ''} ${g}
       <span class="tab-count">${_groupCounts[g] || 0}</span>
     </div>`
  ).join('');

  // Footer context: dive number · site · region
  const dive = dives.find(d => d.id === _footageDiveId);
  const footerCtx = (dive ? [
    dive.divenum ? '#' + dive.divenum : '',
    dive.site,
    dive.region,
  ].filter(Boolean).join('  ·  ') : '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;');

  const qAttr = esc(q);

  return `
    <div class="fmp-results">
      <div class="sp-grid-1col">
        ${cellsHtml || '<div class="sp-grid-empty">No results</div>'}
        ${sentinelHtml}
      </div>
    </div>
    <div class="fmp-tabs${isSearch ? ' fmp-tabs--hidden' : ''}" role="tablist">
      ${tabsHtml}
    </div>
    <div class="fmp-search-row">
      <div class="fmp-search-inner">
        <input id="fmp-search" type="text" class="fmp-search-input"
               value="${qAttr}" placeholder="Type to search species…"
               autocomplete="off" oninput="onMobilePickerInput()">
        <button class="fmp-free-btn"
                onmousedown="event.preventDefault();_footageFreeText()">+ Free text</button>
      </div>
    </div>
    <div class="fmp-footer">
      <span class="fmp-footer-tag">FOOTAGE</span>
      <span class="fmp-footer-ctx">${footerCtx}</span>
      <button class="fmp-close" onclick="cancelMobilePicker()">✕</button>
    </div>`;
}

// Show the mobile picker overlay. Creates it if it doesn't exist yet.
function _showMobilePicker() {
  let mob = document.getElementById('footage-mob-picker');
  if (!mob) {
    mob = document.createElement('div');
    mob.id = 'footage-mob-picker';
    document.body.appendChild(mob);
  }
  _disconnectPickerObs();
  const q = (document.getElementById('footage-sp-input')?.value || '').trim();
  mob.innerHTML = _mobilePickerHtml(q);
  mob.style.display = 'flex';
  // Auto-focus the search input (slight delay keeps iOS keyboard happy)
  setTimeout(() => { const inp = document.getElementById('fmp-search'); if (inp) inp.focus(); }, 60);
  if (_pickerFullList.length > _pickerBatchCount) _watchPickerSentinel();
}

// Hide the mobile picker overlay and reset picker state.
function cancelMobilePicker() {
  const mob = document.getElementById('footage-mob-picker');
  if (mob) mob.style.display = 'none';
  _footagePickerOpen = false;
  // Return to the Videos tab (where the add-sighting form lives)
  if (window.innerWidth <= 600) switchFootageTab('videos');
}

// Accept whatever is typed as a free-text species (no database match required).
// Works for both mobile overlay (#fmp-search) and desktop add-form (#footage-sp-input).
function _footageFreeText() {
  const mob      = document.getElementById('footage-mob-picker');
  const isMobile = mob && mob.style.display !== 'none';
  const val = ((isMobile
    ? document.getElementById('fmp-search')?.value
    : document.getElementById('footage-sp-input')?.value) || '').trim();
  if (!val) return;
  _footageFormSpecies = { scientificName: val, commonName: val,
                          aphiaId: null, group: '', validated: false };
  const input = document.getElementById('footage-sp-input');
  if (input) input.value = val;
  _footagePickerOpen = false;
  if (isMobile) {
    cancelMobilePicker();
  } else {
    const dive = dives.find(d => d.id === _footageDiveId);
    if (dive) _updatePickerColumn(dive);
  }
}

// Re-renders just the results grid when the overlay search input changes.
// Hides tabs while a search query is active; shows them again on clear.
function onMobilePickerInput() {
  const q = (document.getElementById('fmp-search')?.value || '').trim();
  _disconnectPickerObs();
  _pickerBatchCount = 60;
  _pickerFullList   = [];

  const isSearch = q.length >= 2;
  let visibleResults;

  if (isSearch) {
    visibleResults = searchLocalSpecies(q);
  } else {
    _pickerFullList = SPECIES_DB
      .filter(s => s[3] === _footagePickerTab)
      .map(s => ({ commonName: s[0], scientificName: s[1], aphiaId: s[2],
                   group: s[3], photoUrl: s[4] || '', iucnStatus: s[5] || '' }))
      .sort((a, b) => a.commonName.localeCompare(b.commonName));
    visibleResults = _pickerFullList.slice(0, _pickerBatchCount);
  }

  const hasMore   = _pickerFullList.length > _pickerBatchCount;
  const cellsHtml = visibleResults.map(_pickerCell1ColHtml).join('');

  // Update results grid in place — preserves DOM structure around it
  const grid = document.querySelector('#footage-mob-picker .sp-grid-1col');
  if (grid) {
    grid.innerHTML = cellsHtml || '<div class="sp-grid-empty">No results</div>';
    if (hasMore) grid.insertAdjacentHTML('beforeend',
      '<div id="sp-mob-sentinel" class="sp-load-sentinel"></div>');
  }

  // Hide category tabs while a search query is active
  const tabs = document.querySelector('#footage-mob-picker .fmp-tabs');
  if (tabs) tabs.classList.toggle('fmp-tabs--hidden', isSearch);

  // Scroll results back to top
  const resultsEl = document.querySelector('#footage-mob-picker .fmp-results');
  if (resultsEl) resultsEl.scrollTop = 0;

  if (hasMore) _watchPickerSentinel();
}

// ── Abundance toggle (updates in place, no full re-render) ────────────────────

function setFootageAbundance(ab) {
  _footageFormAbundance = (_footageFormAbundance === ab) ? '' : ab;
  document.querySelectorAll('.af-ab span[data-ab]').forEach(el => {
    el.classList.toggle('on', el.dataset.ab === _footageFormAbundance);
  });
}

// ── Save sighting (new clip appended to sighting.clips) ───────────────────────

function saveFootageSighting(diveId) {
  const dive = dives.find(d => d.id === diveId);
  if (!dive) return;
  const vid = (dive.videos || []).find(v => v.file === _footageFormVidFile);
  if (!vid) return;

  // Species is required
  if (!_footageFormSpecies) {
    const input = document.getElementById('footage-sp-input');
    if (input) { input.focus(); input.style.borderColor = 'var(--warn)'; }
    return;
  }

  // Validate timestamp (optional but must be well-formed if present)
  const tsRaw = (document.getElementById('footage-ts-input')?.value || '').trim();
  const ts = tsRaw ? _validateTimestamp(tsRaw) : '';
  if (tsRaw && ts === null) {
    const tsInput = document.getElementById('footage-ts-input');
    if (tsInput) { tsInput.focus(); tsInput.style.borderColor = 'var(--warn)'; }
    return;
  }

  const noteRaw = (document.getElementById('footage-note-input')?.value || '').trim();

  // Build the new clip object
  const newClip = { video: vid.file };
  if (ts)      newClip.time = ts;
  if (noteRaw) newClip.note = noteRaw;

  // Find or create sighting, append clip
  if (!dive.marine) dive.marine = [];
  const existing = dive.marine.find(m =>
    m.scientificName.toLowerCase() === _footageFormSpecies.scientificName.toLowerCase()
  );
  if (existing) {
    // Migrate old scalar format to clips array if needed
    if (!Array.isArray(existing.clips)) {
      existing.clips = existing.video
        ? [{ video: existing.video, ...(existing.time ? { time: existing.time } : {}) }]
        : [];
      delete existing.video;
      delete existing.time;
    }
    existing.clips.push(newClip);
    if (_footageFormAbundance) existing.abundance = _footageFormAbundance;
  } else {
    const entry = { ..._footageFormSpecies, clips: [newClip] };
    if (_footageFormAbundance) entry.abundance = _footageFormAbundance;
    dive.marine.push(entry);
  }

  dive._pendingSync = true;
  localStorage.setItem('divelog-dives', JSON.stringify(dives));
  _fmPush(dive);

  // Reset form state
  _footageFormVidFile   = null;
  _footageFormSpecies   = null;
  _footageFormAbundance = '';
  _footagePickerOpen    = false;

  // Re-render modal and history (updates ▶ glyphs and footage pill in timeline)
  _renderFootageBody(dive);
  if (typeof renderHistory === 'function') renderHistory();
}

// Timestamp validation — accepts mm:ss, m:ss, h:mm:ss; rejects anything else.
function _validateTimestamp(raw) {
  const m2 = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (m2) {
    if (parseInt(m2[2]) > 59) return null;
    return m2[1].padStart(2, '0') + ':' + m2[2];
  }
  const m3 = raw.match(/^(\d+):(\d{2}):(\d{2})$/);
  if (m3) {
    if (parseInt(m3[2]) > 59 || parseInt(m3[3]) > 59) return null;
    return m3[1] + ':' + m3[2] + ':' + m3[3];
  }
  return null;
}

// ── Attach existing sighting to a video (appends a new clip) ─────────────────

function openFootageAttachForm(sciName) {
  _footageAttachingStampName  = sciName;
  _footageFormVidFile         = null; // close any open add-form
  _footageEditingStampName    = null; // close any open stamp-edit
  _footageEditingStampClipIdx = null;
  const dive = dives.find(d => d.id === _footageDiveId);
  if (dive) _renderFootageBody(dive);
}

function cancelFootageAttachForm() {
  _footageAttachingStampName = null;
  const dive = dives.find(d => d.id === _footageDiveId);
  if (dive) _renderFootageBody(dive);
}

function saveFootageAttach(diveId, sciName) {
  const dive = dives.find(d => d.id === diveId);
  if (!dive) return;
  const sighting = (dive.marine || []).find(m => m.scientificName === sciName);
  if (!sighting) return;

  const vidFile = document.getElementById('footage-attach-vid')?.value ?? '';
  const vid     = (dive.videos || []).find(v => v.file === vidFile);
  if (!vid) return;

  const tsRaw = (document.getElementById('footage-attach-ts')?.value || '').trim();
  const ts    = tsRaw ? _validateTimestamp(tsRaw) : '';
  if (tsRaw && ts === null) {
    const el = document.getElementById('footage-attach-ts');
    if (el) { el.focus(); el.style.borderColor = 'var(--warn)'; }
    return;
  }

  const noteRaw = (document.getElementById('footage-attach-note')?.value || '').trim();

  // Migrate old scalar format to clips array if needed
  if (!Array.isArray(sighting.clips)) {
    sighting.clips = sighting.video
      ? [{ video: sighting.video, ...(sighting.time ? { time: sighting.time } : {}) }]
      : [];
    delete sighting.video;
    delete sighting.time;
  }

  const newClip = { video: vid.file };
  if (ts)      newClip.time = ts;
  if (noteRaw) newClip.note = noteRaw;
  sighting.clips.push(newClip);

  dive._pendingSync = true;
  localStorage.setItem('divelog-dives', JSON.stringify(dives));
  _fmPush(dive);

  _footageAttachingStampName = null;
  _renderFootageBody(dive);
  if (typeof renderHistory === 'function') renderHistory();
}

// ── Stamp edit (timestamp + abundance + note) ─────────────────────────────────

function editFootageStamp(diveId, sciName, clipIdx) {
  const dive = dives.find(d => d.id === diveId);
  if (!dive) return;
  const sighting = (dive.marine || []).find(m => m.scientificName === sciName);
  if (!sighting) return;
  const clips = _sightingClips(sighting);
  _footageEditingStampName    = sciName;
  _footageEditingStampClipIdx = clipIdx;
  _footageEditAbundance       = sighting.abundance || '';
  _footageEditNote            = (clips[clipIdx] && clips[clipIdx].note) || '';
  _footageFormVidFile         = null; // close any open add-form
  _renderFootageBody(dive);
}

function cancelFootageStampEdit() {
  _footageEditingStampName    = null;
  _footageEditingStampClipIdx = null;
  _footageEditNote            = '';
  const dive = dives.find(d => d.id === _footageDiveId);
  if (dive) _renderFootageBody(dive);
}

function setFootageEditAbundance(ab) {
  _footageEditAbundance = (_footageEditAbundance === ab) ? '' : ab;
  document.querySelectorAll('.af-ab-sm span[data-eab]').forEach(el => {
    el.classList.toggle('on', el.dataset.eab === _footageEditAbundance);
  });
}

function saveFootageStampEdit(diveId, sciName, clipIdx) {
  const dive = dives.find(d => d.id === diveId);
  if (!dive) return;
  const sighting = (dive.marine || []).find(m => m.scientificName === sciName);
  if (!sighting) return;

  const tsRaw = (document.getElementById('footage-edit-ts')?.value || '').trim();
  const ts    = tsRaw ? _validateTimestamp(tsRaw) : '';
  if (tsRaw && ts === null) {
    const el = document.getElementById('footage-edit-ts');
    if (el) { el.focus(); el.style.borderColor = 'var(--warn)'; }
    return;
  }

  // Migrate old scalar format to clips array if needed
  if (!Array.isArray(sighting.clips)) {
    sighting.clips = sighting.video
      ? [{ video: sighting.video, ...(sighting.time ? { time: sighting.time } : {}) }]
      : [];
    delete sighting.video;
    delete sighting.time;
  }

  const clip = sighting.clips[clipIdx];
  if (!clip) return;

  if (ts)   clip.time = ts;
  else      delete clip.time;

  const noteRaw = (document.getElementById('footage-edit-note')?.value || '').trim();
  if (noteRaw) clip.note = noteRaw;
  else         delete clip.note;

  if (_footageEditAbundance) sighting.abundance = _footageEditAbundance;

  dive._pendingSync = true;
  localStorage.setItem('divelog-dives', JSON.stringify(dives));
  _fmPush(dive);

  _footageEditingStampName    = null;
  _footageEditingStampClipIdx = null;
  _footageEditNote            = '';
  _renderFootageBody(dive);
  if (typeof renderHistory === 'function') renderHistory();
}

function unlinkFootageStamp(diveId, sciName, clipIdx) {
  const dive = dives.find(d => d.id === diveId);
  if (!dive) return;
  const sighting = (dive.marine || []).find(m => m.scientificName === sciName);
  if (!sighting) return;

  // Migrate old scalar format to clips array if needed
  if (!Array.isArray(sighting.clips)) {
    sighting.clips = sighting.video
      ? [{ video: sighting.video, ...(sighting.time ? { time: sighting.time } : {}) }]
      : [];
    delete sighting.video;
    delete sighting.time;
  }
  sighting.clips.splice(clipIdx, 1);

  dive._pendingSync = true;
  localStorage.setItem('divelog-dives', JSON.stringify(dives));
  _fmPush(dive);

  _renderFootageBody(dive);
  if (typeof renderHistory === 'function') renderHistory();
}

// ── Delete video record ────────────────────────────────────────────────────────

// async since v2.99 — the confirmation is now the in-app confirmAction()
// overlay rather than a blocking native confirm(). Both call sites are inline
// onclick handlers that ignore the return value, so nothing awaits this.
async function deleteFootageVideo(diveId, filename) {
  const dive = dives.find(d => d.id === diveId);
  if (!dive || !dive.videos) return;

  // Safety: only confirm if a sighting clip actually references this video —
  // empty videos delete instantly. Tagged sightings survive; their links clear.
  // (This state-dependent "sometimes ask" is exactly why armDelete can't cover
  // it — armDelete decides before the handler runs.)
  const linked = (dive.marine || []).some(m =>
    (Array.isArray(m.clips) && m.clips.some(c => c.video === filename)) || m.video === filename);
  if (linked && !await confirmAction(
        'Remove "' + filename + '"? Tagged sightings stay, but their links to this video are cleared.',
        { confirmLabel: 'Remove', danger: true })) return;

  // Orphan sightings that referenced this video (keep the sighting, clear the clip links)
  (dive.marine || []).forEach(m => {
    if (Array.isArray(m.clips)) {
      m.clips = m.clips.filter(c => c.video !== filename);
    } else if (m.video === filename) {
      delete m.video;
      delete m.time;
    }
  });

  dive.videos = dive.videos.filter(v => v.file !== filename);

  dive._pendingSync = true;
  localStorage.setItem('divelog-dives', JSON.stringify(dives));
  _fmPush(dive);

  _renderFootageBody(dive);
  if (typeof renderHistory === 'function') renderHistory();
}

// ── Reviewed toggle ────────────────────────────────────────────────────────────

function toggleFootageReviewed(diveId, filename) {
  const dive = dives.find(d => d.id === diveId);
  if (!dive || !dive.videos) return;
  const vid = dive.videos.find(v => v.file === filename);
  if (!vid) return;

  vid.reviewed = !vid.reviewed;
  dive._pendingSync = true;
  localStorage.setItem('divelog-dives', JSON.stringify(dives));
  _fmPush(dive);

  _renderFootageBody(dive);
}

// ── Bulk file import ──────────────────────────────────────────────────────────

function importFootageFiles(event, diveId) {
  const files = Array.from(event.target.files || []);
  event.target.value = ''; // reset so the same files can be re-picked
  _processFootageFiles(files, diveId);
}

function handleFootageDragOver(event) {
  event.preventDefault();
  event.dataTransfer.dropEffect = 'copy';
}

function handleFootageDragEnter(event) {
  event.preventDefault();
  event.currentTarget.classList.add('fm-drag-over');
}

function handleFootageDragLeave(event) {
  // Only remove when leaving the modal itself, not a child element
  if (!event.currentTarget.contains(event.relatedTarget)) {
    event.currentTarget.classList.remove('fm-drag-over');
  }
}

function handleFootageDrop(event) {
  event.preventDefault();
  event.currentTarget.classList.remove('fm-drag-over');
  const files = Array.from(event.dataTransfer.files || []);
  _processFootageFiles(files, _footageDiveId);
}

function _processFootageFiles(files, diveId) {
  const dive = dives.find(d => d.id === diveId);
  if (!dive || !files.length) return;
  if (!dive.videos) dive.videos = [];

  // Filter to video MIME types only; surface a hint for anything skipped
  const videoFiles = files.filter(f => f.type.startsWith('video/'));
  const skipped    = files.length - videoFiles.length;

  // Dedupe by filename
  const existing = new Set(dive.videos.map(v => v.file));
  for (const f of videoFiles) {
    if (existing.has(f.name)) continue;
    // No `path` here, deliberately: these arrive by drag-and-drop or a file
    // input, so webkitRelativePath is empty for loose files and — even when a
    // folder drop populates it — it is relative to whatever was dropped, not
    // to a connected video folder, so it would not resolve. These entries keep
    // resolving by stem exactly as before; the auto-match flow is what mints
    // path-based refs (js/footage-match.js).
    dive.videos.push({ file: f.name, modified: f.lastModified, size: f.size, reviewed: false });
    existing.add(f.name);
  }

  // Sort by modified ascending — matches recording order for GoPro sequential files
  dive.videos.sort((a, b) => a.modified - b.modified);

  dive._pendingSync = true;
  localStorage.setItem('divelog-dives', JSON.stringify(dives));
  _fmPush(dive);

  _renderFootageBody(dive);

  if (skipped > 0) {
    _showFootageHint(`Skipped ${skipped} non-video file${skipped !== 1 ? 's' : ''}.`);
  }
}

function _showFootageHint(msg) {
  const old = document.getElementById('footage-hint');
  if (old) old.remove();
  const hint = document.createElement('div');
  hint.id        = 'footage-hint';
  hint.className = 'fm-hint';
  hint.textContent = msg;
  const target = document.querySelector('#footage-modal .dm-videos-scroll')
    || document.getElementById('footage-body');
  target?.appendChild(hint);
  setTimeout(() => hint.remove(), 4000);
}

// ── Player — v2.35 ────────────────────────────────────────────────────────────

function _cleanupPlayer() {
  if (_videoEl) {
    _videoEl.pause();
    _videoEl.removeAttribute('src');
    _videoEl.load(); // forces browser to release the resource + exit media session
    _videoEl = null;
  }
  _playerPaused   = true;
  _duration       = 0;
  _scrubMouseDown = false;
  window.removeEventListener('mousemove', _onScrubMousemove);
  window.removeEventListener('mouseup',   _onScrubMouseup);
}

function _initPlayer(d) {
  _cleanupPlayer();
  _videoEl = document.getElementById('fm-video-el');
  if (!_videoEl) return;

  _videoEl.addEventListener('timeupdate',     _onTimeUpdate);
  _videoEl.addEventListener('loadedmetadata', function() { _onMetadata(d); });
  _videoEl.addEventListener('ended',          _onEnded);
  _videoEl.addEventListener('play',           function() { _playerPaused = false; _syncPlayBtn(); });
  _videoEl.addEventListener('pause',          function() { _playerPaused = true;  _syncPlayBtn(); });

  const track = document.getElementById('fm-scrub-track');
  if (track) track.addEventListener('mousedown', _onScrubMousedown);
  window.addEventListener('mousemove', _onScrubMousemove);
  window.addEventListener('mouseup',   _onScrubMouseup);

  // Resolve a playable URL — proxy preferred; original ref also stem-matches
  // the granted folder, so masters play if that folder is the one granted.
  const vid = (d.videos || []).find(v => v.file === _activeVideoFile);
  if (vid) {
    const sources = [];
    if (vid.proxy) sources.push({ role: 'proxy', kind: 'local', ref: vid.proxy });
    // vid.path (root-qualified relative path, v2.982+) when we have it — it
    // resolves exactly, where vid.file only resolves by ambiguous stem.
    sources.push({ role: 'original', kind: 'local', ref: vid.path || vid.file });
    const url = resolveVideoUrl({ sources }, { prefer: 'proxy', allowKinds: ['local'] });
    if (url) {
      // A resolved url only means the file was FOUND by the last scan — not
      // that its bytes are readable. A cloud-provider file set to online-only
      // lists fine and then fails to load when its provider app isn't running,
      // which without this handler is a completely silent dead end: press play,
      // nothing happens, no reason given. Assigned as .onerror rather than
      // addEventListener so a re-render replaces the handler instead of
      // stacking duplicates.
      _videoEl.onerror = () => _showPlaybackError(vid);
      _videoEl.src = url;
      _videoEl.load();
    } else {
      const stage = document.getElementById('fm-vstage');
      if (stage && !stage.querySelector('.vstage-nosrc')) {
        // Say which of the two situations this actually is. The old message
        // ("connect the video folder below") was wrong whenever a folder WAS
        // connected — it sent you to do a thing you'd already done, when the
        // real problem is that THIS file isn't among the ones that folder
        // holds. Naming the file is what makes that actionable.
        const st = (typeof proxyStatus === 'function') ? proxyStatus() : { state: 'none', count: 0 };
        const hint = document.createElement('div');
        hint.className   = 'vstage-nosrc';
        hint.textContent = st.state === 'connected'
          ? `${_activeVideoFile} isn't in the ${st.count} videos Shoal can currently see — add the folder holding it, below.`
          : 'No video folder connected yet — connect the folder your footage lives in, below.';
        stage.appendChild(hint);
      }
    }
  }
}

// The <video> element failed to load bytes for a file the scan DID find —
// distinct from the resolve-failure case above (file not in any connected
// folder), and it needs a different answer. The common cause on macOS is a
// cloud-provider file stored online-only whose provider app isn't running to
// materialise it; naming the provider is what makes that fixable rather than
// mysterious. Anything else gets an honest "couldn't play it" instead of a
// guess at the reason.
function _showPlaybackError(vid) {
  const stage = document.getElementById('fm-vstage');
  if (!stage || stage.querySelector('.vstage-nosrc')) return;
  const path = (typeof _localPathForRef === 'function')
    ? _localPathForRef(vid.path || vid.file)
    : null;
  const provider = (typeof cloudProviderNameForPath === 'function')
    ? cloudProviderNameForPath(path)
    : null;
  const hint = document.createElement('div');
  hint.className = 'vstage-nosrc';
  hint.textContent = provider
    ? `${vid.file} is stored online-only in ${provider}. Open the ${provider} app so it can download the file, then press play again.`
    : `${vid.file} was found but couldn't be played — it may have been moved, renamed, or deleted since the last scan.`;
  stage.appendChild(hint);
}

function _onMetadata(d) {
  _duration = (_videoEl && isFinite(_videoEl.duration)) ? _videoEl.duration : 0;
  const dur = document.getElementById('fm-dur-label');
  if (dur) dur.textContent = _fmtTime(_duration);
  _refreshMarkers(d);
  if (_watchPendingSecs !== null) {
    seekToTime(_watchPendingSecs);
    _watchPendingSecs = null;
  }
}

function _onEnded() {
  _playerPaused = true;
  _syncPlayBtn();
}

function _onTimeUpdate() {
  if (!_videoEl || _scrubMouseDown) return;
  const t   = _videoEl.currentTime;
  const pct = _duration > 0 ? Math.min(100, (t / _duration) * 100) : 0;
  const p   = pct.toFixed(2) + '%';
  const played = document.getElementById('fm-scrub-played');
  const head   = document.getElementById('fm-scrub-head');
  const liveT  = document.getElementById('fm-live-time');
  const curLbl = document.getElementById('fm-cur-label');
  if (played) played.style.width = p;
  if (head)   head.style.left   = p;
  const ts = _fmtTime(t);
  if (liveT)  liveT.textContent = ts;
  if (curLbl) curLbl.textContent = ts;
}

function _syncPlayBtn() {
  const btn = document.getElementById('fm-play-btn');
  if (btn) btn.textContent = _playerPaused ? '▶' : '⏸';
}

// ── IUCN markers on scrubber ──────────────────────────────────────────────────

function _refreshMarkers(d) {
  const track = document.getElementById('fm-scrub-track');
  if (!track || !_activeVideoFile || _duration <= 0) return;
  track.querySelectorAll('.scrub-marker').forEach(m => m.remove());
  track.insertAdjacentHTML('beforeend', _markersHtml(d));
}

function _markersHtml(d) {
  const html = [];
  for (const m of (d.marine || [])) {
    const iucn = (SP_IUCN_MAP && SP_IUCN_MAP[m.scientificName]) || '';
    const cls  = ['CR','EN','VU','NT','LC','DD'].includes(iucn) ? iucn : (m.aphiaId ? 'NT' : 'free');
    for (const c of _sightingClips(m)) {
      if (c.video !== _activeVideoFile || !c.time) continue;
      const secs = _tsToSeconds(c.time);
      if (secs === null || _duration <= 0) continue;
      const pct  = Math.min(99, (secs / _duration) * 100).toFixed(2);
      const nm   = esc(m.commonName || m.scientificName);
      html.push('<span class="scrub-marker ' + cls + '" style="left:' + pct + '%"'
        + ' title="' + nm + ' \xb7 ' + esc(c.time) + '"'
        + ' onclick="event.stopPropagation();seekToTime(' + secs + ')"></span>');
    }
  }
  return html.join('');
}

// ── Scrubber mouse interaction ─────────────────────────────────────────────────

function _scrubFrac(event) {
  const track = document.getElementById('fm-scrub-track');
  if (!track) return 0;
  const rect = track.getBoundingClientRect();
  return Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
}

function _onScrubMousedown(event) {
  if (event.target.classList.contains('scrub-marker')) return;
  _scrubMouseDown = true;
  _applyScrubFrac(_scrubFrac(event));
  event.preventDefault();
}

function _onScrubMousemove(event) {
  if (!_scrubMouseDown) return;
  _applyScrubFrac(_scrubFrac(event));
}

function _onScrubMouseup(event) {
  if (!_scrubMouseDown) return;
  _scrubMouseDown = false;
  const frac = _scrubFrac(event);
  _applyScrubFrac(frac);
  if (_videoEl && _duration > 0) _videoEl.currentTime = frac * _duration;
}

function _applyScrubFrac(frac) {
  const pct    = (frac * 100).toFixed(2) + '%';
  const played = document.getElementById('fm-scrub-played');
  const head   = document.getElementById('fm-scrub-head');
  const liveT  = document.getElementById('fm-live-time');
  const curLbl = document.getElementById('fm-cur-label');
  if (played) played.style.width = pct;
  if (head)   head.style.left   = pct;
  const ts = _fmtTime(frac * _duration);
  if (liveT)  liveT.textContent = ts;
  if (curLbl) curLbl.textContent = ts;
}

// ── Transport controls ────────────────────────────────────────────────────────

function togglePlay() {
  if (!_videoEl) return;
  if (_videoEl.paused) _videoEl.play();
  else _videoEl.pause();
}

function seekToTime(secs) {
  if (_videoEl && _duration > 0) {
    _videoEl.currentTime = Math.max(0, Math.min(_duration, secs));
  }
  _applyScrubFrac(_duration > 0 ? Math.max(0, Math.min(1, secs / _duration)) : 0);
}

function nudgeTime(delta) {
  if (!_videoEl || _duration <= 0) return;
  seekToTime(_videoEl.currentTime + delta);
}

function nudgeFrame(dir) {
  nudgeTime(dir / 30); // assumes ~30 fps — adequate for clip review
}

function seekPrevMoment() {
  if (!_videoEl || _duration <= 0) return;
  const cur  = _videoEl.currentTime;
  const dive = dives.find(d => d.id === _footageDiveId);
  if (!dive) return;
  const ts = _videoMoments(dive).filter(s => s < cur - 0.1).pop();
  if (ts !== undefined) seekToTime(ts);
}

function seekNextMoment() {
  if (!_videoEl || _duration <= 0) return;
  const cur  = _videoEl.currentTime;
  const dive = dives.find(d => d.id === _footageDiveId);
  if (!dive) return;
  const ts = _videoMoments(dive).find(s => s > cur + 0.1);
  if (ts !== undefined) seekToTime(ts);
}

function _videoMoments(d) {
  const secs = [];
  for (const m of (d.marine || [])) {
    for (const c of _sightingClips(m)) {
      if (c.video !== _activeVideoFile || !c.time) continue;
      const s = _tsToSeconds(c.time);
      if (s !== null) secs.push(s);
    }
  }
  return secs.sort((a, b) => a - b);
}

// ── Video switching ───────────────────────────────────────────────────────────

function switchToVideo(filename) {
  if (_videoEl) _videoEl.pause();
  _activeVideoFile  = filename;
  _watchPendingSecs = null; // cleared; watchSeek sets this before calling us
  _rightTagActive   = false;
  _tagSpecies       = null;
  _tagAbundance     = '';
  _tagEditKey       = null;
  _tagEditIdx       = null;
  _tagEditAb        = '';
  _tagEditNewSpecies = null;
  const dive = dives.find(d => d.id === _footageDiveId);
  if (dive) _renderFootageBody(dive);
}

// ── Keyboard transport (modal-open only) ─────────────────────────────────────
// Space = play/pause, ←/→ = ±5 s. Inert while typing in an input so the note
// and search fields keep normal spacebar behaviour.
function _onFootageKeydown(e) {
  const t = e.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
  if (e.code === 'Space') {
    e.preventDefault(); // also stops a focused button re-firing on space
    togglePlay();
  } else if (e.key === 'ArrowLeft') {
    e.preventDefault();
    nudgeTime(-5);
  } else if (e.key === 'ArrowRight') {
    e.preventDefault();
    nudgeTime(5);
  }
}

// ── Time utilities ────────────────────────────────────────────────────────────

function _tsToSeconds(ts) {
  if (!ts) return null;
  const m2 = ts.match(/^(\d+):(\d{2})$/);
  if (m2) return parseInt(m2[1]) * 60 + parseInt(m2[2]);
  const m3 = ts.match(/^(\d+):(\d{2}):(\d{2})$/);
  if (m3) return parseInt(m3[1]) * 3600 + parseInt(m3[2]) * 60 + parseInt(m3[3]);
  return null;
}

function _fmtTime(secs) {
  if (!isFinite(secs) || secs < 0) return '0:00';
  const s   = Math.floor(secs);
  const h   = Math.floor(s / 3600);
  const m   = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return h + ':' + String(m).padStart(2,'0') + ':' + String(sec).padStart(2,'0');
  return m + ':' + String(sec).padStart(2,'0');
}

// Zero-padded timecode for storing in clip objects (e.g. "01:12" not "1:12")
function _fmtTimecode(secs) {
  if (!isFinite(secs) || secs < 0) return '00:00';
  const s   = Math.floor(secs);
  const h   = Math.floor(s / 3600);
  const m   = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return h + ':' + String(m).padStart(2,'0') + ':' + String(sec).padStart(2,'0');
  return String(m).padStart(2,'0') + ':' + String(sec).padStart(2,'0');
}

// ── Tag mode — v2.36 ─────────────────────────────────────────────────────────

// Partial DOM update: replace only .dm-right without touching the player.
// Preserves the list scroll position so expanding a row below the fold
// doesn't jump back to the top.
function _updateRightCol(d) {
  const grid  = document.querySelector('#footage-modal .dm-grid');
  if (!grid) return;
  const right = grid.querySelector('.dm-right');
  if (!right) return;
  const scroll    = right.querySelector('.dm-right-scroll');
  const scrollTop = scroll ? scroll.scrollTop : 0;
  right.outerHTML = _rightColHtml(d);
  const newScroll = grid.querySelector('.dm-right .dm-right-scroll');
  if (newScroll && scrollTop) newScroll.scrollTop = scrollTop;
  _refreshSideTabCount(d);
}

// Update left-column clip counts after a sighting is saved/linked.
function _refreshLeftClipCounts(d) {
  document.querySelectorAll('#footage-modal .vrow').forEach(row => {
    const fn = row.querySelector('.vfn')?.getAttribute('title');
    if (!fn) return;
    const vid = (d.videos || []).find(v => v.file === fn);
    if (!vid) return;
    const tagCount = (d.marine || []).reduce((n, m) =>
      n + _sightingClips(m).filter(c => c.video === fn).length, 0);
    const sub = vid.reviewed
      ? (tagCount ? tagCount + ' tagged' : 'reviewed')
      : (tagCount ? tagCount + ' tagged · unreviewed' : 'not reviewed');
    const vsub = row.querySelector('.vsub');
    if (vsub) vsub.textContent = sub;
  });
}

// ── Right column renderers ────────────────────────────────────────────────────

function _rightColHtml(d) {
  const tagActive = !_watchMode;
  // role="tab"/aria-selected: this switches the whole right column's mode
  // (tag vs watch), not a filter — the same content-switching shape as the
  // dive-file's .df-seg tab strip (js/history.js), so it gets the same
  // WAI-ARIA tab pattern rather than aria-pressed.
  const modeBar = '<div class="dm-right-bar"><div class="mode-toggle" role="tablist">'
    + '<button class="' + (tagActive ? 'active' : '') + '" role="tab" aria-selected="' + tagActive + '" data-mode="tag"'
    + ' onmousedown="event.preventDefault();setFootageMode(this.dataset.mode)">✎ Tag</button>'
    + '<button class="' + (_watchMode ? 'active' : '') + '" role="tab" aria-selected="' + _watchMode + '" data-mode="watch"'
    + ' onmousedown="event.preventDefault();setFootageMode(this.dataset.mode)">▶ Watch</button>'
    + '</div></div>';

  if (_watchMode) {
    return '<div class="dm-right">' + modeBar + _rightWatchHtml(d) + '</div>';
  }

  if (!_activeVideoFile) {
    return '<div class="dm-right">' + modeBar
      + '<div class="dm-right-placeholder">Select a video, then use<br>＋ Tag here to log sightings</div>'
      + '</div>';
  }

  if (_rightTagActive) {
    return '<div class="dm-right">' + modeBar + _rightTagFormHtml(d) + '</div>';
  }

  return '<div class="dm-right">' + modeBar + _rightTaggedHtml(d) + '</div>';
}

function _rightTaggedHtml(d) {
  const moments = [];
  for (const m of (d.marine || [])) {
    const sciKey = m.scientificName || m.customId || '';
    _sightingClips(m).forEach((c, ci) => {
      if (c.video !== _activeVideoFile) return;
      moments.push({ m, c, ci, sciKey });
    });
  }
  moments.sort((a, b) => {
    const sa = (_tsToSeconds(a.c.time) !== null ? _tsToSeconds(a.c.time) : 9999);
    const sb = (_tsToSeconds(b.c.time) !== null ? _tsToSeconds(b.c.time) : 9999);
    return sa - sb;
  });

  const h = '<div class="dm-right-h">Tagged in this video '
    + '<span class="dm-right-n">' + moments.length + '</span></div>';

  if (!moments.length) {
    return h + '<div class="dm-right-scroll"><div class="dm-right-empty">'
      + 'No sightings tagged yet.<br>Use ＋ Tag here to start.</div></div>';
  }

  return h + '<div class="dm-right-scroll">'
    + moments.map(({ m, c, ci, sciKey }) => _momentRowHtml(d, m, c, ci, sciKey)).join('')
    + '</div>';
}

function _momentRowHtml(d, m, c, ci, sciKey) {
  const name    = m.commonName || m.scientificName || sciKey;
  const nameEsc = esc(name);
  const sciEsc  = esc(sciKey);
  const secs    = c.time ? _tsToSeconds(c.time) : null;
  const timeD   = esc(c.time) || '\u2014';
  const jumpBtn = secs !== null
    ? '<button class="m-jump" onclick="seekToTime(' + secs + ')">\u25B6 ' + timeD + '</button>'
    : '<span class="m-jump m-no-ts">\u2014</span>';

  // Inline edit state for this row?
  if (_tagEditKey === sciKey && _tagEditIdx === ci) {
    const abHtml = ['R','O','C'].map(ab =>
      '<span data-eab="' + ab + '" class="' + (_tagEditAb === ab ? 'on' : '') + '"'
      + ' onmousedown="event.preventDefault();setTagEditAbundance(\'' + ab + '\')">' + ab + '</span>'
    ).join('');
    const existNote = esc(c.note || '');
    const existTime = esc(c.time || '');
    const dataAttrs = ' data-did="' + d.id + '" data-sci="' + sciEsc + '" data-cidx="' + ci + '"';
    return '<div class="moment moment-editing">'
      + '<div class="m-inline-form">'
      + '<div class="m-inline-name">' + nameEsc
      + ' <span class="m-swap-arrow" id="tag-edit-swap-sel"></span></div>'
      + '<input class="af-input" id="tag-edit-swap" type="text"'
      + ' placeholder="\uD83D\uDD0D Change animal\u2026" autocomplete="off" oninput="onTagEditSwapInput()">'
      + '<div class="m-swap-results" id="tag-edit-swap-results"></div>'
      + '<div class="m-edit-row">'
      + '<input class="af-input af-ts" id="tag-edit-time" type="text"'
      + ' placeholder="mm:ss" value="' + existTime + '" autocomplete="off">'
      + '<input class="af-input af-note" id="tag-edit-note" type="text"'
      + ' placeholder="Note" value="' + existNote + '" autocomplete="off">'
      + '</div>'
      + '<div class="m-edit-ab">' + abHtml + '</div>'
      + '<div class="m-inline-acts">'
      + '<button class="m-del"' + dataAttrs
      + ' onclick="deleteTagMoment(+this.dataset.did,this.dataset.sci,+this.dataset.cidx)"'
      + ' title="Remove this tagged moment">\uD83D\uDDD1</button>'
      + '<span class="m-acts-gap"></span>'
      + '<button class="fm-btn" onclick="cancelTagMomentEdit()">Cancel</button>'
      + '<button class="fm-btn primary"' + dataAttrs
      + ' onclick="saveTagMomentEdit(+this.dataset.did,this.dataset.sci,+this.dataset.cidx)">'
      + 'Save</button>'
      + '</div></div></div>';
  }

  const noteH = c.note
    ? '<span class="m-note">' + esc(c.note) + '</span>'
    : '';
  return '<div class="moment">'
    + jumpBtn
    + '<div class="m-body">'
    + '<span class="m-name" title="' + nameEsc + '">' + nameEsc + '</span>'
    + noteH
    + '</div>'
    + '<button class="m-edit"'
    + ' data-did="' + d.id + '" data-sci="' + sciEsc + '" data-cidx="' + ci + '"'
    + ' onclick="editTagMoment(+this.dataset.did,this.dataset.sci,+this.dataset.cidx)"'
    + ' title="Edit">\u270E</button>'
    + '</div>';
}

function _tagBrowseCellHtml(r) {
  const sciAttr   = esc(r.scientificName || '');
  const comAttr   = esc(r.commonName || '');
  const grpAttr   = esc(r.group || '');
  const nameH     = esc(r.commonName || r.scientificName || '');
  const sciH      = esc(r.scientificName || '');
  const photoUrl  = r.photoUrl
    ? r.photoUrl.replace('/square.', '/medium.').replace('square.', 'medium.')
    : '';
  const img       = photoUrl
    ? '<img src="' + photoUrl + '" alt="" loading="lazy">'
    : '<div class="bcell-ph">' + (GROUP_EMOJI[r.group] || '🐟') + '</div>';
  const iucnH     = r.iucnStatus ? iucnBadge(r.iucnStatus) : '';
  const selKey    = _tagSpecies ? (_tagSpecies.scientificName || _tagSpecies.customId || '') : null;
  const rKey      = r.scientificName || r.customId || '';
  const selected  = selKey !== null && selKey === rKey;
  return '<div class="bcell' + (selected ? ' b-selected' : '') + '"'
    + ' data-sci="' + sciAttr + '" data-common="' + comAttr + '"'
    + ' data-aphia="' + (r.aphiaId || '') + '" data-group="' + grpAttr + '"'
    + ' data-custom="' + (r.customId || '') + '"'
    + ' onclick="pickTagSpecies(this)">'
    + '<span class="bcell-check">✓</span>'
    + img
    + '<div class="bcell-info">'
    + '<div class="bcell-name">' + nameH + '</div>'
    + '<div class="bcell-sci">'  + sciH  + '</div>'
    + (iucnH ? '<div style="margin-top:3px">' + iucnH + '</div>' : '')
    + '</div></div>';
}

// ── Tag picker: rows, grid, empty states ─────────────────────────────────────

function _tagRegions() { return _tagRegionFilter && _tagRegionFilter.regions; }

function _tagRowsForGroup(group) {
  const regions = _tagRegions();
  return SPECIES_DB
    .filter(s => s[3] === group && speciesRowInRegions(s, regions))
    .map(s => ({ commonName: s[0], scientificName: s[1], aphiaId: s[2],
                 group: s[3], photoUrl: s[4] || '', iucnStatus: s[5] || '' }))
    .sort((a, b) => a.commonName.localeCompare(b.commonName));
}

// Zero-match IS the free-text affordance, mirroring the log form's mobile
// picker (_mspEmptyStateHtml, js/species.js) — the old floating "+ Free text"
// button sat in the footer, permanently occupying space for something needed
// on a small minority of tags, and gave no hint of WHEN it applied.
//
// One case the log form's version doesn't have to handle: a region filter is
// active here by default, so "no results" can mean "not near this dive" rather
// than "not in the database". Offering free text there would mint a custom
// species that already exists under a different region tag, so that case gets
// "Show all" instead — the filter is the thing to undo, not the database.
function _tagEmptyStateHtml(q, isSearch, existsUnfiltered) {
  const showAll = '<button type="button" class="sp-region-banner-btn"'
    + ' onmousedown="event.preventDefault();clearTagRegionFilter()">Show all species</button>';
  if (isSearch && existsUnfiltered) {
    return '<div class="b1col-empty">No match recorded near '
      + esc(_tagRegionFilter ? _tagRegionFilter.country : '') + ','
      + ' but this one is in the database.<br>' + showAll + '</div>';
  }
  if (isSearch) {
    return '<div class="bcell bcell-addfree" onmousedown="event.preventDefault();_tagFreeText()">'
      + '<div class="bcell-addfree-ic">+</div>'
      + '<div class="bcell-info">'
      + '<div class="bcell-name">Add “' + esc(q) + '” as a new sighting</div>'
      + '<div class="bcell-sci">Not in the species database — tap to log it as free text</div>'
      + '</div></div>';
  }
  if (_tagRegionFilter) {
    return '<div class="b1col-empty">Nothing in this group recorded near '
      + esc(_tagRegionFilter.country) + '.<br>' + showAll + '</div>';
  }
  return '<div class="b1col-empty">No results</div>';
}

// The grid's entire contents for a given query — browse (<2 chars) or search.
function _tagGridHtml(q) {
  const query = (q || '').trim();
  if (query.length >= 2) {
    // regions is passed INTO the search, not filtered on afterward — see the
    // comment on searchLocalSpecies (js/species.js). Filtering an already-
    // capped 8-result list silently lost region-relevant matches to more
    // numerous unrelated ones that happened to rank earlier in the database
    // (e.g. "wrasse": 25 tropical species predate the 6 UK ones, so a UK
    // filter's 8-slot cap never had a UK wrasse left to keep).
    const regions = _tagRegions();
    const hits = searchLocalSpecies(query, regions);
    if (!hits.length) {
      // Existence check ignores the region filter, purely to pick the right
      // empty-state message ("not near this dive" vs "not in the database").
      const existsUnfiltered = !!regions && searchLocalSpecies(query).length > 0;
      return _tagEmptyStateHtml(query, true, existsUnfiltered);
    }
    return hits.slice(0, 40).map(_tagBrowseCellHtml).join('');
  }
  const rows = _tagRowsForGroup(_footagePickerTab);
  if (!rows.length) return _tagEmptyStateHtml('', false, false);
  return rows.slice(0, 40).map(_tagBrowseCellHtml).join('');
}

function clearTagRegionFilter() {
  _tagRegionFilter = null;
  const band = document.querySelector('#footage-modal .tag-region-band');
  if (band) band.remove();
  const b1col = document.querySelector('#footage-modal .b1col');
  if (b1col) b1col.innerHTML = _tagGridHtml(document.getElementById('tag-search')?.value || '');
}

// Footer. Split out of _rightTagFormHtml so picking a species can re-render
// JUST this — a full _updateRightCol would rebuild the grid too, throwing away
// the scroll position and search query mid-tag.
function _tagFootHtml() {
  const curTs   = (_videoEl && _duration > 0) ? _fmtTimecode(_videoEl.currentTime) : '';
  const hasSel  = !!_tagSpecies;
  const selName = hasSel ? (_tagSpecies.commonName || _tagSpecies.scientificName) : '';
  const abH = ['R','O','C'].map(ab =>
    '<span data-ab="' + ab + '" class="' + (_tagAbundance === ab ? 'on' : '') + '"'
    + ' onmousedown="event.preventDefault();setTagAbundance(\'' + ab + '\')">' + ab + '</span>'
  ).join('');

  // Progressive disclosure: while browsing, the footer is one row. Note,
  // abundance and Save only exist once a species is picked — before that they
  // were ~140px of controls you cannot use yet, taken straight out of the
  // photo grid, which is the part you're actually reading.
  return '<div class="tagfoot' + (hasSel ? ' has-sel' : '') + '">'
    + '<div class="tagfoot-row">'
    + '<input id="tag-search" class="tagfoot-input" type="text" placeholder="🔍 Search species…"'
    + ' autocomplete="off" oninput="onTagPickerInput()">'
    + (curTs ? '<span class="tagfoot-ts">@ ' + curTs + '</span>' : '')
    + (hasSel ? '' : '<button class="fm-btn tagfoot-x" onclick="cancelTagForm()" title="Stop tagging">✕</button>')
    + '</div>'
    + (hasSel
        ? '<div class="tagfoot-sel on" id="tag-sel">✓ ' + esc(selName) + '</div>'
          + '<div class="tagfoot-row">'
          + '<input id="tag-note" class="tagfoot-input af-note" type="text"'
          + ' placeholder="✎ Add a note (optional)" autocomplete="off">'
          + '<div class="af-ab">' + abH + '</div>'
          + '</div>'
          + '<div class="tagfoot-acts">'
          + '<button class="fm-btn" onclick="cancelTagForm()">Cancel</button>'
          + '<button class="fm-btn primary" id="tag-save-btn" onclick="saveTagSighting()">Save sighting</button>'
          + '</div>'
        : '')
    + '</div>';
}

// Re-render the footer alone, preserving what the user has already typed and
// (for the free-text path, which fires on mousedown and so never blurs) focus.
function _refreshTagFoot() {
  const foot = document.querySelector('#footage-modal .tagfoot');
  if (!foot) return;
  const q        = document.getElementById('tag-search')?.value || '';
  const note     = document.getElementById('tag-note')?.value || '';
  const hadFocus = document.activeElement && document.activeElement.id === 'tag-search';
  foot.outerHTML = _tagFootHtml();
  const inp = document.getElementById('tag-search');
  if (inp) { inp.value = q; if (hadFocus) inp.focus(); }
  const n = document.getElementById('tag-note');
  if (n && note) n.value = note;
}

function _rightTagFormHtml(d) {
  // Already-logged pills: all sightings in this dive for quick-linking
  const marine  = d.marine || [];
  const chips   = marine.map(m => {
    const sciKey = m.scientificName || m.customId || '';
    const name   = m.commonName || m.scientificName || sciKey;
    const emoji  = GROUP_EMOJI[m.group] || '🐟';
    const nameH  = esc(emoji + ' ' + name);
    const sciEsc = esc(sciKey);
    return '<span class="ulchip" data-key="' + sciEsc + '"'
      + ' onclick="linkAlreadyLogged(this.dataset.key)">' + nameH + '</span>';
  }).join('');

  const ulBand = marine.length
    ? '<div class="ul-band"><div class="ul-band-lbl">Tap to link at current time</div>'
      + '<div class="ulchips">' + chips + '</div></div>'
    : '';

  // Category tabs. onmousedown (not onclick) beats the search input's blur —
  // but a native <button> only auto-fires click on keyboard activation, never
  // mousedown, so despite being a real button element this was NOT actually
  // operable by keyboard until the onkeydown twin below was added.
  const tabsH = '<div class="browse-tabs" role="tablist">' + BROWSE_GROUPS.map(g =>
    '<button class="browse-tab' + (g === _footagePickerTab ? ' active' : '') + '"'
    + ' role="tab" aria-selected="' + (g === _footagePickerTab) + '"'
    + ' data-group="' + g + '"'
    + ' onmousedown="event.preventDefault();setTagPickerTab(\'' + g + '\')"'
    + ' onkeydown="if(event.key===\'Enter\'||event.key===\' \'){event.preventDefault();setTagPickerTab(\'' + g + '\')}">'
    + (GROUP_EMOJI[g] || '') + ' ' + g + '</button>'
  ).join('') + '</div>';

  // Region narrowing, stated compactly — same "narrow by where you dived, with
  // a one-click escape" contract as the log form's Country pre-filter.
  const regionBand = _tagRegionFilter
    ? '<div class="tag-region-band">'
      + '<span class="tag-region-name">📍 Near ' + esc(_tagRegionFilter.country) + '</span>'
      + '<button type="button" class="sp-region-banner-btn"'
      + ' onmousedown="event.preventDefault();clearTagRegionFilter()">Show all</button>'
      + '</div>'
    : '';

  const gridH = '<div class="b1col">' + _tagGridHtml('') + '</div>';

  return ulBand + regionBand + tabsH
    + '<div class="b1col-scroll" id="tag-b1col-scroll">' + gridH + '</div>'
    + _tagFootHtml();
}

// ── Tag-form actions ──────────────────────────────────────────────────────────

function openTagForm() {
  if (!_activeVideoFile) return;
  _rightTagActive = true;
  _tagSpecies     = null;
  _tagAbundance   = '';
  const dive = dives.find(d => d.id === _footageDiveId);
  if (dive) _updateRightCol(dive);
  // Pin the panel open. "+ Tag here" is a button in the CENTRE column, so
  // without this the form would open inside a panel parked off-screen —
  // the click would look like it did nothing. Hover can't cover this: the
  // pointer is over the transport bar, not the panel.
  pinWatchSightings();
}

function cancelTagForm() {
  _rightTagActive = false;
  _tagSpecies     = null;
  _tagAbundance   = '';
  const dive = dives.find(d => d.id === _footageDiveId);
  if (dive) _updateRightCol(dive);
  unpinWatchSightings(); // openTagForm pinned it — backing out releases it
}

// Accept whatever is typed in the tag search as a free-text species (no DB
// match required) and select it for tagging — mirrors the add-form's free-text
// path. Mints a stable customId so the same typed name links up across dives.
function _tagFreeText() {
  const val = (document.getElementById('tag-search')?.value || '').trim();
  if (!val) return;
  const customId = (typeof resolveCustomId === 'function') ? resolveCustomId(val) : undefined;
  _tagSpecies = { scientificName: val, commonName: val, aphiaId: null,
                  group: '', validated: false, ...(customId ? { customId } : {}) };
  // Footer only — a full _updateRightCol would rebuild the grid and lose the
  // query that produced this free-text name in the first place.
  _refreshTagFoot();
}

function pickTagSpecies(el) {
  document.querySelectorAll('#footage-modal .bcell.b-selected')
    .forEach(c => c.classList.remove('b-selected'));
  el.classList.add('b-selected');
  const isCustom = !!el.dataset.custom;
  _tagSpecies = {
    scientificName: el.dataset.sci   || '',
    commonName:     el.dataset.common || '',
    aphiaId:        el.dataset.aphia  ? +el.dataset.aphia : null,
    group:          el.dataset.group  || '',
    validated:      !isCustom,
    ...(isCustom ? { customId: el.dataset.custom } : {}),
  };
  // Reveal the note/abundance/Save controls, which don't exist until now.
  _refreshTagFoot();
}

function setTagAbundance(ab) {
  _tagAbundance = (_tagAbundance === ab) ? '' : ab;
  document.querySelectorAll('#footage-modal .tagfoot .af-ab span').forEach(el => {
    el.classList.toggle('on', el.dataset.ab === _tagAbundance);
  });
}

function setTagPickerTab(group) {
  _footagePickerTab = group;
  document.querySelectorAll('#footage-modal .browse-tab').forEach(btn => {
    const on = btn.dataset.group === group;
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-selected', on);
  });
  const b1col = document.querySelector('#footage-modal .b1col');
  if (!b1col) return;
  const inp = document.getElementById('tag-search');
  if (inp) inp.value = '';
  b1col.innerHTML = _tagGridHtml('');
  const scroll = document.getElementById('tag-b1col-scroll');
  if (scroll) scroll.scrollTop = 0;
  const tabs = document.querySelector('#footage-modal .browse-tabs');
  if (tabs) tabs.style.display = 'flex';
}

function onTagPickerInput() {
  const q = (document.getElementById('tag-search')?.value || '').trim();
  const b1col = document.querySelector('#footage-modal .b1col');
  if (!b1col) return;

  b1col.innerHTML = _tagGridHtml(q);

  // Show/hide tabs when searching
  const tabs = document.querySelector('#footage-modal .browse-tabs');
  if (tabs) tabs.style.display = q.length >= 2 ? 'none' : 'flex';

  // Re-mark selection if still visible
  if (_tagSpecies) {
    const sciA = esc(_tagSpecies.scientificName);
    const sel  = b1col.querySelector('[data-sci="' + sciA + '"]');
    if (sel) sel.classList.add('b-selected');
  }
}

// Save a new sighting + clip at current video timestamp
function saveTagSighting() {
  if (!_tagSpecies) {
    const inp = document.getElementById('tag-search');
    if (inp) { inp.focus(); inp.style.borderColor = 'var(--warn)'; }
    return;
  }
  const dive = dives.find(d => d.id === _footageDiveId);
  if (!dive || !_activeVideoFile) return;

  const ts   = (_videoEl && _duration > 0) ? _fmtTimecode(_videoEl.currentTime) : '';
  const note = (document.getElementById('tag-note')?.value || '').trim();
  const clip = { video: _activeVideoFile };
  if (ts)   clip.time = ts;
  if (note) clip.note = note;

  // Find existing sighting or create new one
  const sciKey = _tagSpecies.scientificName || _tagSpecies.customId || '';
  if (!dive.marine) dive.marine = [];
  const existing = dive.marine.find(m =>
    (m.scientificName || m.customId || '') === sciKey
  );
  if (existing) {
    if (!Array.isArray(existing.clips)) existing.clips = [];
    existing.clips.push(clip);
    if (_tagAbundance) existing.abundance = _tagAbundance;
  } else {
    const entry = Object.assign({}, _tagSpecies, { clips: [clip] });
    if (_tagAbundance) entry.abundance = _tagAbundance;
    dive.marine.push(entry);
  }

  dive._pendingSync = true;
  localStorage.setItem('divelog-dives', JSON.stringify(dives));
  _fmPush(dive);

  _rightTagActive = false;
  _tagSpecies     = null;
  _tagAbundance   = '';

  _updateRightCol(dive);
  _refreshMarkers(dive);
  _refreshLeftClipCounts(dive);
  if (typeof renderHistory === 'function') renderHistory();
  // Deliberately does NOT release the panel. Saving a sighting is usually the
  // START of working on it — adding a note, fixing the timestamp — so closing
  // here forced an immediate reopen. The panel already closes on hover-away
  // and on the tab's own chevron, which is enough; nothing auto-closes it.
}

// Quick-link: add a clip for an existing sighting at the current timestamp
function linkAlreadyLogged(speciesKey) {
  const dive = dives.find(d => d.id === _footageDiveId);
  if (!dive || !_activeVideoFile) return;
  const sighting = (dive.marine || []).find(m =>
    (m.scientificName || m.customId || '') === speciesKey
  );
  if (!sighting) return;

  const ts = (_videoEl && _duration > 0) ? _fmtTimecode(_videoEl.currentTime) : '';
  if (!Array.isArray(sighting.clips)) sighting.clips = [];
  const clip = { video: _activeVideoFile };
  if (ts) clip.time = ts;
  sighting.clips.push(clip);

  dive._pendingSync = true;
  localStorage.setItem('divelog-dives', JSON.stringify(dives));
  _fmPush(dive);

  _rightTagActive = false;
  _tagSpecies     = null;
  _tagAbundance   = '';

  _updateRightCol(dive);
  _refreshMarkers(dive);
  _refreshLeftClipCounts(dive);
  if (typeof renderHistory === 'function') renderHistory();
  // Deliberately does NOT release the panel. Saving a sighting is usually the
  // START of working on it — adding a note, fixing the timestamp — so closing
  // here forced an immediate reopen. The panel already closes on hover-away
  // and on the tab's own chevron, which is enough; nothing auto-closes it.
}

// ── Inline moment editing ─────────────────────────────────────────────────────

function editTagMoment(diveId, speciesKey, clipIdx) {
  const dive     = dives.find(d => d.id === diveId);
  if (!dive) return;
  const sighting = (dive.marine || []).find(m =>
    (m.scientificName || m.customId || '') === speciesKey
  );

  _tagEditKey = speciesKey;
  _tagEditIdx = clipIdx;
  _tagEditAb  = sighting ? (sighting.abundance || '') : '';
  _tagEditNewSpecies = null;

  _updateRightCol(dive);
}

function cancelTagMomentEdit() {
  _tagEditKey = null;
  _tagEditIdx = null;
  _tagEditAb  = '';
  _tagEditNewSpecies = null;
  const dive = dives.find(d => d.id === _footageDiveId);
  if (dive) _updateRightCol(dive);
}

function setTagEditAbundance(ab) {
  _tagEditAb = (_tagEditAb === ab) ? '' : ab;
  document.querySelectorAll('#footage-modal .m-edit-ab span').forEach(el => {
    el.classList.toggle('on', el.dataset.eab === _tagEditAb);
  });
}

function saveTagMomentEdit(diveId, speciesKey, clipIdx) {
  const dive     = dives.find(d => d.id === diveId);
  if (!dive) return;
  const sighting = (dive.marine || []).find(m =>
    (m.scientificName || m.customId || '') === speciesKey
  );
  if (!sighting) return;
  if (!Array.isArray(sighting.clips)) sighting.clips = [];
  const clip = sighting.clips[clipIdx];
  if (!clip) return;

  // Timestamp — empty clears it; an unparseable value blocks the save
  const tsRaw = (document.getElementById('tag-edit-time')?.value || '').trim();
  if (tsRaw && _tsToSeconds(tsRaw) === null) {
    const tEl = document.getElementById('tag-edit-time');
    if (tEl) { tEl.focus(); tEl.style.borderColor = 'var(--warn)'; }
    return;
  }
  if (tsRaw) clip.time = _fmtTimecode(_tsToSeconds(tsRaw));
  else       delete clip.time;

  const noteRaw = (document.getElementById('tag-edit-note')?.value || '').trim();
  if (noteRaw) clip.note = noteRaw;
  else         delete clip.note;
  if (_tagEditAb) sighting.abundance = _tagEditAb;

  // Species swap — move the clip to the chosen animal. The original sighting
  // stays on the dive (it may carry its own abundance/records); only the
  // video tag moves.
  const newKey = _tagEditNewSpecies
    ? (_tagEditNewSpecies.scientificName || _tagEditNewSpecies.customId || '')
    : '';
  if (newKey && newKey !== speciesKey) {
    sighting.clips.splice(clipIdx, 1);
    let target = dive.marine.find(m =>
      (m.scientificName || m.customId || '') === newKey
    );
    if (!target) {
      target = Object.assign({}, _tagEditNewSpecies, { clips: [] });
      dive.marine.push(target);
    }
    if (!Array.isArray(target.clips)) target.clips = [];
    target.clips.push(clip);
  }

  dive._pendingSync = true;
  localStorage.setItem('divelog-dives', JSON.stringify(dives));
  _fmPush(dive);

  _tagEditKey = null;
  _tagEditIdx = null;
  _tagEditAb  = '';
  _tagEditNewSpecies = null;

  _updateRightCol(dive);
  _refreshMarkers(dive);
  _refreshLeftClipCounts(dive);
  if (typeof renderHistory === 'function') renderHistory();
}

// Remove a tagged moment (the clip only — the sighting stays on the dive).
// async since v2.99 — see deleteFootageVideo above.
async function deleteTagMoment(diveId, speciesKey, clipIdx) {
  const dive     = dives.find(d => d.id === diveId);
  if (!dive) return;
  const sighting = (dive.marine || []).find(m =>
    (m.scientificName || m.customId || '') === speciesKey
  );
  if (!sighting || !Array.isArray(sighting.clips) || !sighting.clips[clipIdx]) return;
  if (!await confirmAction(
        'Remove this tagged moment? The sighting stays on the dive — only the video tag is removed.',
        { confirmLabel: 'Remove', danger: true })) return;

  sighting.clips.splice(clipIdx, 1);

  dive._pendingSync = true;
  localStorage.setItem('divelog-dives', JSON.stringify(dives));
  _fmPush(dive);

  _tagEditKey = null;
  _tagEditIdx = null;
  _tagEditAb  = '';
  _tagEditNewSpecies = null;

  _updateRightCol(dive);
  _refreshMarkers(dive);
  _refreshLeftClipCounts(dive);
  if (typeof renderHistory === 'function') renderHistory();
}

// "Change animal…" search inside the inline edit form. Typing always clears
// the previous pick — the text is just a query until a result is clicked.
function onTagEditSwapInput() {
  _tagEditNewSpecies = null;
  const sel = document.getElementById('tag-edit-swap-sel');
  if (sel) sel.textContent = '';
  const box = document.getElementById('tag-edit-swap-results');
  if (!box) return;
  const q = (document.getElementById('tag-edit-swap')?.value || '').trim();
  if (q.length < 2) { box.innerHTML = ''; return; }
  const results = searchLocalSpecies(q).slice(0, 5);
  box.innerHTML = results.map(r => {
    const sciA = (r.scientificName || '').replace(/&/g,'&amp;').replace(/"/g,'&quot;');
    const comA = (r.commonName || '').replace(/&/g,'&amp;').replace(/"/g,'&quot;');
    const nameH = (r.commonName || r.scientificName || '').replace(/&/g,'&amp;').replace(/</g,'&lt;');
    const sciH  = (r.scientificName || '').replace(/&/g,'&amp;').replace(/</g,'&lt;');
    return '<div class="m-swap-row"'
      + ' data-sci="' + sciA + '" data-common="' + comA + '"'
      + ' data-aphia="' + (r.aphiaId || '') + '" data-group="' + (r.group || '').replace(/"/g,'&quot;') + '"'
      + ' data-custom="' + (r.customId || '') + '"'
      + ' onclick="pickTagEditSwap(this)">'
      + nameH + (sciH && sciH !== nameH ? ' <span class="sci">' + sciH + '</span>' : '')
      + '</div>';
  }).join('');
}

function pickTagEditSwap(el) {
  const isCustom = !!el.dataset.custom;
  _tagEditNewSpecies = {
    scientificName: el.dataset.sci    || '',
    commonName:     el.dataset.common || '',
    aphiaId:        el.dataset.aphia  ? +el.dataset.aphia : null,
    group:          el.dataset.group  || '',
    validated:      !isCustom,
    ...(isCustom ? { customId: el.dataset.custom } : {}),
  };
  const chosen = _tagEditNewSpecies.commonName || _tagEditNewSpecies.scientificName;
  const inp = document.getElementById('tag-edit-swap');
  if (inp) inp.value = chosen;
  const box = document.getElementById('tag-edit-swap-results');
  if (box) box.innerHTML = '';
  const sel = document.getElementById('tag-edit-swap-sel');
  if (sel) sel.textContent = '→ ' + chosen;
}

// ── Watch mode — v2.37 ───────────────────────────────────────────────────────

// One centred row holding everything: playback controls, ＋ Tag here, and the
// reviewed toggle — which had its own right-aligned .rev-row until v2.981.
//
// Two problems that row-per-action layout caused, both fixed by this shape:
// the actions sat hard right, directly beneath the slide-in sightings panel,
// so opening the panel covered exactly the two buttons you reach for most;
// and stacking them cost ~45px of vertical chrome that the video wants. The
// row is centred rather than right-aligned so the controls stay clear of the
// panel's 380–420px footprint at any realistic window width.
function _transportHtml(d, activeVid, noVid) {
  const dis = noVid ? ' disabled' : '';
  const base = '<button class="tp-btn" onclick="seekPrevMoment()" title="Prev tagged moment"' + dis + '>⏮</button>'
    + '<button class="tp-btn play" id="fm-play-btn" onclick="togglePlay()"' + dis + '>▶</button>'
    + '<button class="tp-btn" onclick="seekNextMoment()" title="Next tagged moment"' + dis + '>⏭</button>'
    + '<span class="tp-sep"></span>'
    + '<button class="tp-btn" onclick="nudgeTime(-5)"  title="-5 s"' + dis + '>–5</button>'
    + '<button class="tp-btn" onclick="nudgeTime(5)"   title="+5 s"' + dis + '>5›</button>';
  const tagExtra = !_watchMode
    ? '<button class="tp-btn" onclick="nudgeFrame(-1)" title="-1 frame"' + dis + '>◄|</button>'
      + '<button class="tp-btn" onclick="nudgeFrame(1)"  title="+1 frame"' + dis + '>|►</button>'
      + '<span class="tp-sep"></span>'
      + '<button class="tp-tag" onclick="openTagForm()"' + dis + '>＋ Tag here</button>'
      + _revToggleHtml(d, activeVid, noVid)
    : '';
  return '<div class="transport">' + base + tagExtra + '</div>';
}

// Reviewed toggle — rendered inside the transport row (see above). Watch mode
// has no tagging controls at all, so it gets neither this nor ＋ Tag here.
function _revToggleHtml(d, activeVid, noVid) {
  if (_watchMode) return '';
  const isReviewed = !!(activeVid && activeVid.reviewed);
  const fileAttrQ  = activeVid ? esc(activeVid.file) : '';
  return '<button class="rev-toggle' + (isReviewed ? ' on' : '') + '"'
    + ' data-did="' + d.id + '" data-file="' + fileAttrQ + '"'
    + ' aria-pressed="' + isReviewed + '"'
    + ' onclick="toggleFootageReviewed(+this.dataset.did, this.dataset.file)"'
    + (noVid ? ' disabled' : '') + '>'
    + '<span class="rev-box">' + (isReviewed ? '✓' : '') + '</span>'
    + (isReviewed ? 'Reviewed' : 'Mark reviewed')
    + '</button>';
}

// Partial update: replace the transport row without touching video or scrubber.
function _updateCenterControls(d) {
  const activeVid = _activeVideoFile ? (d.videos || []).find(v => v.file === _activeVideoFile) : null;
  const noVid     = !activeVid;
  const center    = document.querySelector('#footage-modal .dm-center');
  if (!center) return;

  const oldTrans = center.querySelector('.transport');
  if (oldTrans) oldTrans.outerHTML = _transportHtml(d, activeVid, noVid);

  _syncPlayBtn();
}

// Toggle between Tag and Watch modes without closing the modal
// Watch-mode sightings panel: hover peeks it open, clicking the tab PINS it.
// Hover alone would be a trap — it's unusable by keyboard, unreachable by
// touch, and makes clicking a sighting feel precarious (any stray mouse exit
// closes the thing you're aiming at). CSS handles the hover/:focus-within
// case; this only handles the deliberate pin.
// Despite the name, .dm-side-tab isn't a WAI-ARIA tab (it doesn't switch
// between multiple options) — it's a disclosure control for a panel that can
// ALSO peek open on hover, so aria-expanded should track the deliberate,
// click-driven "pinned" state specifically, not the transient hover peek.
// Centralised here since three functions touch .pinned and the button
// (.dm-side-tab) is a different element than the one that gets the class.
function _syncSideTabAria() {
  const side = document.querySelector('#footage-modal .dm-side');
  const tab  = side && side.querySelector('.dm-side-tab');
  if (tab) tab.setAttribute('aria-expanded', side.classList.contains('pinned') ? 'true' : 'false');
}

function toggleWatchSightings() {
  const side = document.querySelector('#footage-modal .dm-side');
  if (!side) return;
  if (side.classList.contains('pinned')) unpinWatchSightings();
  else { side.classList.add('pinned'); side.classList.remove('dismissed'); _syncSideTabAria(); }
}

// Force the panel open (idempotent) — for flows that put something INTO the
// panel from outside it, where hover can't help because the pointer is
// somewhere else entirely.
function pinWatchSightings() {
  const side = document.querySelector('#footage-modal .dm-side');
  if (side) side.classList.add('pinned');
  _syncSideTabAria();
}

// Release the panel back to hover-only, i.e. hand the video back. Called when
// a tagging flow finishes (saved or cancelled) — that's the moment the user
// is done with the panel, and leaving it pinned there means the answer to
// "how do I get back to watching?" is a control they have to go hunting for.
//
// `.dismissed` is what makes this actually visible. Every control that
// unpins — the tab, Save, Cancel — sits INSIDE .dm-side, so at the moment of
// the click the pointer is over the panel and `.dm-side:hover` would snap it
// straight back open: the button would appear to do nothing at all. So the
// panel is also marked dismissed, which suppresses hover-open until the
// pointer genuinely leaves (see the onmouseleave on .dm-side, which clears
// it so the next hover behaves normally).
function unpinWatchSightings() {
  const side = document.querySelector('#footage-modal .dm-side');
  if (!side) return;
  side.classList.remove('pinned');
  side.classList.add('dismissed');
  _syncSideTabAria();
}

// The tab shows a sightings count, but _updateRightCol only ever replaces
// .dm-right — the tab is its sibling and would keep a stale number after a
// tag is added or removed.
function _refreshSideTabCount(d) {
  const el = document.getElementById('fm-side-tab-n');
  if (el) el.textContent = (d.marine || []).length;
}

function setFootageMode(mode) {
  const toWatch = (mode === 'watch');
  if (_watchMode === toWatch) return;
  _watchMode = toWatch;

  if (_watchMode) {
    _rightTagActive = false;
    _tagSpecies     = null;
    _tagAbundance   = '';
    _tagEditKey     = null;
    _tagEditIdx     = null;
    _tagEditAb      = '';
  }

  const dive = dives.find(d => d.id === _footageDiveId);
  if (!dive) return;
  _updateRightCol(dive);
  _updateCenterControls(dive);
  // Watch hides the video list — collapse its grid track without re-rendering
  // (the player keeps playing across the toggle)
  const grid = document.querySelector('#footage-modal .dm-grid');
  if (grid) grid.classList.toggle('watch-on', _watchMode);
  // The pin deliberately survives the switch: the panel is an overlay in both
  // modes now, so someone who pinned it open in tag mode means it in watch
  // mode too. (It used to be cleared here, back when leaving watch turned the
  // panel into an ordinary column and a stale .pinned looked "held open".)
}

// ── Watch right column ────────────────────────────────────────────────────────

function _rightWatchHtml(d) {
  const marine = d.marine || [];
  const h = '<div class="dm-right-h">Sightings <span class="dm-right-n">' + marine.length + '</span></div>';
  if (!marine.length) {
    return h + '<div class="dm-right-scroll"><div class="dm-right-empty">No sightings logged for this dive.</div></div>';
  }

  const ordered = marine.slice().sort((a, b) => {
    const gi = g => { const i = BROWSE_GROUPS.indexOf(g); return i === -1 ? 99 : i; };
    const gd = gi(a.group) - gi(b.group);
    return gd !== 0 ? gd : (a.commonName || a.scientificName || '').localeCompare(b.commonName || b.scientificName || '');
  });

  return h + '<div class="dm-right-scroll">' + ordered.map(m => _watchRowHtml(d, m)).join('') + '</div>';
}

function _watchRowHtml(d, m) {
  const sciKey  = m.scientificName || m.customId || '';
  const name    = m.commonName || m.scientificName || sciKey;
  const sci     = (m.commonName && m.scientificName && m.scientificName !== m.commonName) ? m.scientificName : '';
  const iucn    = SP_IUCN_MAP[m.scientificName] || '';
  const rawUrl  = SP_PHOTO_MAP[m.scientificName] || '';
  const nameEsc = esc(name);
  const sciEsc  = esc(sciKey);
  const isExp   = (_watchExpandedKey === sciKey);
  const clips   = _sightingClips(m);
  const totalN  = clips.length;

  const thumb = rawUrl
    ? '<img class="watch-thumb" src="' + rawUrl + '" alt="" loading="lazy">'
    : '<span class="watch-thumb-ph">' + (GROUP_EMOJI[m.group] || '🐟') + '</span>';
  const iucnH = iucn ? iucnBadge(iucn) : '';
  const expandBtn = totalN
    ? '<button class="watch-clips-n" data-sci="' + sciEsc + '"'
      + ' onmousedown="event.preventDefault();toggleWatchExpand(this.dataset.sci)">'
      + (isExp ? '▾' : '▸') + ' ' + totalN + '</button>'
    : '<span class="watch-clips-n watch-clips-none">—</span>';

  const sciJs  = sciKey.replace(/\\/g,'\\\\').replace(/'/g,"\\'");
  const header = '<div class="watch-row' + (isExp ? ' watch-exp' : '') + '"'
    + ' onmousedown="event.preventDefault();toggleWatchExpand(\'' + esc(sciJs) + '\')">'
    + thumb
    + '<div class="watch-info">'
    + '<div class="watch-name">' + nameEsc + '</div>'
    + (sci ? '<div class="watch-sci">' + esc(sci) + '</div>' : '')
    + '</div>'
    + iucnH
    + expandBtn
    + '</div>';

  if (!isExp || !totalN) return header;

  const clipsHtml = clips.map(c => {
    const secs    = c.time ? _tsToSeconds(c.time) : null;
    const timeD   = c.time || '';
    const fileSh  = (c.video || '').replace(/^.*[\\/]/, '');
    const fileEsc = esc(fileSh);
    const fileAttr = esc(c.video || '');
    const jumpBtn = (secs !== null && c.video)
      ? '<button class="watch-jump"'
        + ' data-file="' + fileAttr + '" data-secs="' + secs + '"'
        + ' onmousedown="event.preventDefault();watchSeek(this.dataset.file,+this.dataset.secs)">'
        + '▶ ' + timeD + '</button>'
      : (timeD ? '<span class="watch-jump watch-jump-nosrc">' + timeD + '</span>' : '');
    const noteH = c.note
      ? '<span class="watch-clip-note">' + esc(c.note) + '</span>'
      : '';
    return '<div class="watch-clip">'
      + jumpBtn
      + '<div class="watch-clip-body">'
      + '<span class="watch-clip-file">' + fileEsc + '</span>'
      + noteH
      + '</div></div>';
  }).join('');

  return header + '<div class="watch-clips">' + clipsHtml + '</div>';
}

function toggleWatchExpand(sciKey) {
  _watchExpandedKey = (_watchExpandedKey === sciKey) ? null : sciKey;
  const dive = dives.find(d => d.id === _footageDiveId);
  if (dive) _updateRightCol(dive);
}

// Load a video and seek — the entry point for Watch clip taps
function watchSeek(filename, secs) {
  if (!filename) return;
  if (filename === _activeVideoFile) {
    seekToTime(secs);
    return;
  }
  if (_videoEl) _videoEl.pause();
  _activeVideoFile  = filename;
  _watchPendingSecs = secs;
  const dive = dives.find(d => d.id === _footageDiveId);
  if (dive) _renderFootageBody(dive);
}

// ── Entry glyph helper (history.js uses this) ─────────────────────────────────
// Returns HTML for the ▶ watch glyph on a sighting card. Functional if desktop (≥900px).
function _vidMarkHtml(m, diveId) {
  if (!_sightingHasClips(m)) return '';
  const sciKey = m.scientificName || m.customId || '';
  const c0     = _sightingClips(m)[0];
  const fileInfo = (c0.video || '') + (c0.time ? ' @ ' + c0.time : '');
  // Web build: footage is the Tauri-only workspace, but keep the ▶ + filename as a passive
  // indicator — you can look the file up in your cloud storage. Not a clickable player entry.
  if (!isShell()) {
    return '<span class="vid-mark vid-mark-static" title="' + esc('Footage: ' + fileInfo) + '">▶</span>';
  }
  const sciEsc = esc(sciKey);
  const tip    = esc('In ' + fileInfo + ' — click to watch');
  return '<button class="vid-mark" title="' + tip + '"'
    + ' data-did="' + diveId + '" data-sci="' + sciEsc + '"'
    + ' onclick="event.stopPropagation();openFootage(+this.dataset.did,{mode:\'watch\',expandKey:this.dataset.sci})">'
    + '▶</button>';
}
