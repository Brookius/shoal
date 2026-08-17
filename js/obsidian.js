// Obsidian sync + device import — extracted from index.html (modular migration, step 6).
// Classic script, loaded before the main inline script (shared global scope).
// State: OBS_BASE, obsSettings, obsAvailable, lastSavedDiveId (all global).
// Load-time calls (syncFromObsidian on boot, setSidebarSync) remain in inline script.

// ── Obsidian Local REST API integration ─────────────────────────────────────
const OBS_BASE = 'http://127.0.0.1:27123';
let obsSettings = JSON.parse(localStorage.getItem('divelog-obs-settings') || '{"apikey":"","folder":"Dives"}');
let obsAvailable = false; // tracks whether Obsidian is reachable

function setSyncMode(mode) {
  syncMode = mode;
  localStorage.setItem('divelog-sync-mode', mode);
  // Update segmented control
  ['none','folder','obsidian'].forEach(m => {
    const btn = document.getElementById(`sync-mode-${m}`);
    if (btn) btn.classList.toggle('active', m === mode);
  });
  // Show/hide config sections
  const folderSection = document.getElementById('sync-folder-config');
  const obsSection    = document.getElementById('sync-obs-config');
  if (folderSection) folderSection.style.display = mode === 'folder'   ? '' : 'none';
  if (obsSection)    obsSection.style.display    = mode === 'obsidian' ? '' : 'none';
  // Reset obsAvailable if switching away from obsidian
  if (mode !== 'obsidian') obsAvailable = false;
  updateCount(); // refresh the sync status line for the new mode
}

function saveObsSettings() {
  // Only update from DOM when the Obsidian panel is visible
  const keyEl    = document.getElementById('obs-apikey');
  const folderEl = document.getElementById('obs-folder');
  if (keyEl)    obsSettings.apikey  = keyEl.value;
  if (folderEl) obsSettings.folder  = folderEl.value || 'Dives';
  localStorage.setItem('divelog-obs-settings', JSON.stringify(obsSettings));
}

function obsHeaders(contentType) {
  const h = { 'Content-Type': contentType || 'text/markdown' };
  if (obsSettings.apikey) h['Authorization'] = 'Bearer ' + obsSettings.apikey;
  return h;
}

function obsJsonHeaders() {
  const h = { 'Accept': 'application/json' };
  if (obsSettings.apikey) h['Authorization'] = 'Bearer ' + obsSettings.apikey;
  return h;
}

function setSyncBanner(id, msg, cls) {
  const el = document.getElementById(id);
  if (!el) return;
  el.className = 'sync-banner ' + (cls || '');
  el.innerHTML = msg;
  el.style.display = msg ? 'flex' : 'none';
}

function setSidebarSync(msg) {
  const el = document.getElementById('sidebar-sync');
  if (el) el.textContent = msg;
}

async function testObsConnection() {
  const indicator = document.getElementById('obs-status-indicator');
  const text = document.getElementById('obs-status-text');
  text.textContent = 'Testing…';
  indicator.className = 'obs-status disconnected';
  try {
    // Step 1 — server reachability. Root endpoint needs no auth and returns version info.
    const infoRes = await fetch(OBS_BASE + '/', {
      headers: { 'Accept': 'application/json' }, cache: 'no-store'
    });
    if (!infoRes.ok) {
      text.textContent = 'Error ' + infoRes.status + ' — Obsidian responded unexpectedly';
      indicator.className = 'obs-status error';
      obsAvailable = false;
      return;
    }
    const data = await infoRes.json();
    const versionStr = 'Obsidian ' + (data.versions?.obsidian || '?') + ', plugin v' + (data.versions?.self || '?');

    // Step 2 — API key check. /vault/ requires auth; a wrong key returns 401.
    const authRes = await fetch(OBS_BASE + '/vault/', {
      headers: obsJsonHeaders(), cache: 'no-store'
    });
    if (authRes.status === 401 || authRes.status === 403) {
      text.textContent = 'Reachable but API key rejected — check your key (' + versionStr + ')';
      indicator.className = 'obs-status error';
      obsAvailable = false;
      return;
    }
    if (!authRes.ok) {
      text.textContent = 'Vault check failed (HTTP ' + authRes.status + ') — ' + versionStr;
      indicator.className = 'obs-status error';
      obsAvailable = false;
      return;
    }

    text.textContent = 'Connected — ' + versionStr;
    indicator.className = 'obs-status connected';
    obsAvailable = true;
  } catch (e) {
    text.textContent = 'Cannot reach Obsidian — is it open with the plugin enabled?';
    indicator.className = 'obs-status error';
    obsAvailable = false;
  }
}


// ── IMPORT DIVES FROM DEVICE (.md files) ─────────────────────────────────
// Filenames actually read by the LAST import. syncFromFolder uses this to
// limit migrateLegacyFootage's read-repair to dives that genuinely came from
// the folder just read — see the comment at its call site (js/app.js). Without
// it, picking a new folder rebuilt the PREVIOUS folder's sidecars into the new
// one, because migrateLegacyFootage was handed the whole in-memory array.
let _lastImportFilenames = new Set();

// Files carrying shared_intent, handled after the normal import finishes.
//
// 'copy' — the sender said the recipient may keep it. Ask, then adopt it as a
// genuinely new dive: fresh uid and the next free dive number, so it can never
// collide with (or overwrite) a dive already in the log. The intent flag is
// stripped, since once adopted it's simply theirs.
//
// 'view' — the sender said viewing only, so it is NOT added. Shoal honours
// that; it can't enforce it, and doesn't pretend to (the recipient can open
// the .md in any text editor). A richer read-only preview is a follow-up.
async function _handleSharedDives(shared) {
  // `normalised` (the full body) is collected at the gate but not needed here —
  // frontmatterToDive works from the frontmatter alone, and the journal was
  // stripped before sending anyway. It's kept on the collected object for the
  // read-only preview that 'view' still owes the user.
  for (const { filename, fm } of shared) {
    // (fm, filename) — two parameters. This previously passed `normalised` as
    // the second arg, so the whole file body was bound to `filename`: the id
    // hash ran over the entire document and `_filename` held the markdown.
    // Harmless only because both are overwritten below; a real bug the moment
    // anything reads them earlier.
    const dive = frontmatterToDive(fm, filename);
    const where = [dive.site, dive.date].filter(Boolean).join(' · ') || filename;

    if (dive.shared_intent !== 'copy') {
      showToast(`“${where}” was shared for viewing, so it hasn't been added to your log.`,
                { duration: 7000 });
      continue;
    }

    const yes = await confirmAction(`Add “${where}” to your dive log?`,
                                    { confirmLabel: 'Add to my log' });
    if (!yes) continue;

    delete dive.shared_intent;
    dive.id  = Date.now() + Math.floor(Math.random() * 1000);
    dive.uid = mintUid();                       // never inherit the sender's uid
    dive.divenum = (dives.reduce((m, d) => Math.max(m, parseInt(d.divenum) || 0), 0) || 0) + 1;
    delete dive._filename;                      // canonicalFilename() re-derives it on save
    dive._pendingSync = true;
    dives.push(dive);
    dives.sort((a, b) => (parseInt(a.divenum) || 0) - (parseInt(b.divenum) || 0));
    localStorage.setItem('divelog-dives', JSON.stringify(dives));
    acSaveDiveFields(dive);
    buildSiteHistory();
    renderHistory();
    updateCount();
    if (syncMode === 'obsidian' && obsAvailable) pushToObsidian(dive).catch(() => {});
    else if (syncMode === 'folder') writeToFolder(dive).catch(() => {});
    showToast(`Added as dive #${dive.divenum}.`, { variant: 'success' });
  }
}

async function importDivesFromFiles(files) {
  if (!files || files.length === 0) return;
  _lastImportFilenames = new Set();

  const btn = document.querySelector('#import-md-input-data + button') ||
              document.querySelector('[onclick*="import-md-input"]');
  const statusEl = document.getElementById('import-status');
  const origText = btn ? btn.textContent : '';
  if (btn) btn.textContent = 'Reading…';
  if (statusEl) statusEl.textContent = '';

  const results = await Promise.all(Array.from(files).map(async file => {
    try {
      const text = await file.text();
      return { filename: file.name, text };
    } catch(e) {
      return { filename: file.name, error: true };
    }
  }));

  let added = 0, updated = 0, skipped = 0, errored = 0;
  const sharedWithMe = [];   // files carrying shared_intent — handled after the loop

  for (const result of results) {
    if (!result) continue;
    if (result.error) { errored++; continue; }
    const { filename, text } = result;
    // Normalise line endings — Proton Drive / Android may use CRLF
    const normalised = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const fm = parseFrontmatter(normalised);
    // A file someone shared deliberately. Never merge it into the log on the
    // normal path — the sender chose what should happen to it, and silently
    // absorbing a buddy's dive is exactly the collision the divenum+date dedup
    // below would cause. Collected and dealt with after the loop.
    if (fm && fm.shared_intent) { sharedWithMe.push({ filename, normalised, fm }); continue; }
    if (!fm) { skipped++; continue; }
    // Accept files with type: dive, or any file with a recognisable dive field
    if (fm.type && fm.type !== 'dive') { skipped++; continue; }

    // Parse marine life table (same logic as syncFromObsidian)
    const marineTableMatch = normalised.match(/## Marine life[\s\S]*?\n(\|[\s\S]*?)(?=\n## |\n---\n|$)/);
    let marine = [];
    if (marineTableMatch) {
      const rows = marineTableMatch[1].match(/^\|[^|]+\|[^|]+\|[^|]+\|[^|]+\|[^|]+\|(?:[^|]+\|)*$/mg) || [];
      for (const row of rows) {
        const cells = row.split('|').map(c => c.trim()).filter(Boolean);
        if (cells.length < 5 || cells[0].startsWith('-') || cells[0].toLowerCase().startsWith('species')) continue;
        const sciName = cells[0].replace(/\*/g, '').trim();
        const commonName = cells[1] === '—' ? '' : cells[1];
        // 8-col: Species | Common | Abundance | Count | AphiaID | Validated | Video | Timestamp
        // 6-col: Species | Common | Abundance | Count | AphiaID | Validated
        // 5-col: Species | Common | Count | AphiaID | Validated (legacy)
        const is8col    = cells.length >= 8;
        const is6col    = cells.length >= 6;
        const col2IsROC = ['R','O','C'].includes(cells[2]);
        const abundance = is6col ? (cells[2] === '—' ? '' : cells[2])
                                 : (col2IsROC ? cells[2] : '');
        const count     = is6col ? (parseInt(cells[3]) || null)
                                 : (col2IsROC ? null : (parseInt(cells[2]) || null));
        const aphiaId   = is6col ? (cells[4] === '—' ? null : parseInt(cells[4]) || null)
                                 : (cells[3] === '—' ? null : parseInt(cells[3]) || null);
        const validated = is6col ? (cells[5].includes('✓') || cells[5].toLowerCase() === 'true')
                                 : (cells[4].includes('✓') || cells[4].toLowerCase() === 'true');
        const video     = is8col && cells[6] !== '—' ? cells[6] : undefined;
        const time      = is8col && cells[7] !== '—' ? cells[7] : undefined;
        if (!sciName || sciName === 'Species') continue;
        const dbMatch = SPECIES_DB.find(s =>
          s[1].toLowerCase() === sciName.toLowerCase() ||
          s[0].toLowerCase() === commonName.toLowerCase()
        );
        const sighting = {
          scientificName: dbMatch ? dbMatch[1] : sciName,
          commonName:     dbMatch ? dbMatch[0] : (commonName || sciName),
          aphiaId:        aphiaId || (dbMatch ? dbMatch[2] : null),
          group:          dbMatch ? dbMatch[3] : '',
          abundance, count, validated: validated || !!dbMatch
        };
        if (video) sighting.video = video;
        if (time)  sighting.time  = time;
        marine.push(sighting);
      }
    }
    if (marine.length === 0) {
      // fm.species items may be plain strings (legacy) or objects (v2.0 YAML format)
      marine = (fm.species || []).map(s => {
        const sciName = typeof s === 'string' ? s : (s.scientific || s.common || '');
        const comName = typeof s === 'string' ? s : (s.common || s.scientific || '');
        const dbMatch = SPECIES_DB.find(sp =>
          sp[0].toLowerCase() === comName.toLowerCase() ||
          sp[1].toLowerCase() === sciName.toLowerCase()
        );
        return dbMatch
          ? { scientificName: dbMatch[1], commonName: dbMatch[0], aphiaId: dbMatch[2], group: dbMatch[3], count: 1, validated: true }
          : { scientificName: sciName, commonName: comName, aphiaId: null, group: '', count: 1, validated: false };
      });
    }

    const dive = frontmatterToDive(fm, filename);
    if (!dive.uid) dive.uid = mintUid();
    const fmMarine = dive.marine || []; // save before body-table overwrite — carries clips from YAML
    dive.marine = marine;

    // Restore per-clip footage data from frontmatter (body table doesn't carry it)
    dive.marine.forEach(m => {
      const fmMatch = fmMarine.find(f =>
        f.scientificName.toLowerCase() === m.scientificName.toLowerCase()
      );
      if (fmMatch && _sightingHasClips(fmMatch)) m.clips = _sightingClips(fmMatch);
    });

    const notesMatch = normalised.match(/## Notes\n+([\s\S]*?)(?:\n+##|$)/);
    if (notesMatch) dive.notes = notesMatch[1].trim().replace(/^\*No notes recorded\.\*$/, '');

    const weatherMatch = normalised.match(/\|\s*Weather[^|]*\|\s*([^|\n]+)\|/);
    if (weatherMatch && weatherMatch[1].trim() !== '—') dive.weather = weatherMatch[1].trim();

    const watertypeMatch = normalised.match(/\|\s*Water type[^|]*\|\s*([^|\n]+)\|/);
    if (watertypeMatch && watertypeMatch[1].trim() !== '—') dive.watertype = watertypeMatch[1].trim();

    // Dedup: match on filename first, then divenum+date
    const existingIdx = dives.findIndex(d =>
      d._filename === filename ||
      (d.divenum && d.divenum == dive.divenum && d.date === dive.date)
    );

    if (existingIdx >= 0) {
      const oldDive = dives[existingIdx];
      dives[existingIdx] = { ...oldDive, ...dive };
      // The MD no longer carries videos[]/clips (sidecar era) — an import must
      // not wipe footage that lives only in local state.
      if ((oldDive.videos || []).length && !(dive.videos || []).length) {
        dives[existingIdx].videos = oldDive.videos;
      }
      // Per-sighting: preserve locally-set abundance and clips when the
      // incoming file carries none for that species.
      if (oldDive.marine?.length && dive.marine?.length) {
        dives[existingIdx].marine = dive.marine.map(newM => {
          const oldM = oldDive.marine.find(m =>
            m.scientificName?.toLowerCase() === newM.scientificName?.toLowerCase()
          );
          let out = newM;
          if (oldM && !newM.abundance && oldM.abundance) {
            out = { ...out, abundance: oldM.abundance };
          }
          if (oldM && !_sightingHasClips(newM) && _sightingHasClips(oldM)) {
            out = { ...out, clips: _sightingClips(oldM) };
          }
          return out;
        });
      }
      updated++;
    } else {
      dives.push(dive);
      added++;
    }
    _lastImportFilenames.add(filename);
  }

  dives.sort((a, b) => (parseInt(a.divenum) || 0) - (parseInt(b.divenum) || 0));
  _backfillRegistry(dives);
  applyAllSidecars(dives); // apply any already-loaded sidecars (import is offline; no new load)
  migrateAbundance(); // derive abundance from count for any newly-imported files without it
  localStorage.setItem('divelog-dives', JSON.stringify(dives));
  acBootstrap();
  renderHistory();
  updateCount();
  // Was `dives.length + ' dives (local)'` — restated the exact number
  // .dive-count already shows in large type right above it (updateCount(),
  // same line). Reported live as looking like a duplicate; it was one.
  setSidebarSync('Local');

  // Reset file input so the same files can be re-imported if needed
  const inp = document.getElementById('import-md-input-data');
  if (inp) inp.value = '';

  if (sharedWithMe.length) await _handleSharedDives(sharedWithMe);

  const parts = [];
  if (added)   parts.push(`${added} added`);
  if (updated) parts.push(`${updated} updated`);
  if (skipped) parts.push(`${skipped} skipped (not a dive file)`);
  if (errored) parts.push(`${errored} couldn't be read`);
  const ok = added || updated;
  const summary = (ok ? '✓ ' : '⚠ ') + (parts.join(', ') || 'nothing imported');
  // Used to also flash this summary onto the button itself for 4s, replacing
  // its short fixed label ("↑ Import"). That's unbounded in length — every
  // part above can combine ("✓ 3 added, 2 updated, 1 skipped (not a dive
  // file), 1 couldn't be read") — sitting in a white-space:nowrap, auto-width
  // button with no sibling to absorb overflow: on a phone screen a real
  // multi-part result ran off the edge, illegible. Reported directly (a
  // Proton Drive import hit the errored-file case, one of the longer
  // possible summaries — see the static warning paragraph above this button
  // for why that case exists: Proton's E2E encryption means cloud-only files
  // can't be read via this file input at all, same root cause as folder sync
  // not seeing Proton Drive either). statusEl below has no such constraint,
  // already shows the identical text, and sits a few px from the button —
  // the button now just reverts immediately instead of risking overflow.
  if (btn) btn.textContent = origText;
  if (statusEl) {
    statusEl.textContent = summary;
    statusEl.style.color = ok ? '' : 'var(--warn)';
  }
}

// ── SYNC FROM OBSIDIAN ────────────────────────────────────────────────────
async function syncFromObsidian(showBanner) {
  const folder = (obsSettings.folder || 'Dives').replace(/\/$/, '');
  setSidebarSync('Syncing…');

  try {
    // 1. List all files in the Dives folder
    const listRes = await fetch(
      `${OBS_BASE}/vault/${encodeURIComponent(folder)}/`,
      { headers: obsJsonHeaders() }
    );

    if (!listRes.ok) {
      if (showBanner) {
        setSyncBanner('sync-banner-log', 'Could not reach Obsidian vault — using local cache.', 'warning');
        setSyncBanner('sync-banner-history', 'Could not reach Obsidian vault — using local cache.', 'warning');
      }
      setSidebarSync('Obsidian offline');
      obsAvailable = false;
      return false;
    }

    obsAvailable = true;
    const listData = await listRes.json();
    const mdFiles  = (listData.files || []).filter(f => f.endsWith('.md'));

    if (!mdFiles.length) {
      if (showBanner) {
        setSyncBanner('sync-banner-log', `No dive notes found in "${esc(folder)}/" — save your first dive to get started.`, 'warning');
        setSyncBanner('sync-banner-history', `No dive notes found in "${esc(folder)}/".`, 'warning');
      }
      setSidebarSync('0 dives in vault');
      dives = [];
      updateCount();
      renderHistory();
      return true;
    }

    // 2. Fetch each file in parallel.
    // cache: 'no-store' prevents the browser sending If-None-Match / If-Modified-Since
    // headers; without it the Obsidian REST API responds 304 Not Modified (ok=false)
    // for unchanged files, which silently drops every dive from the loaded set.
    const fetches = mdFiles.map(filename => {
      const path = `${folder}/${filename}`;
      return fetch(`${OBS_BASE}/vault/${encodeURIComponent(path)}`, { headers: obsJsonHeaders(), cache: 'no-store' })
        .then(r => r.ok ? r.text() : null)
        .then(text => text ? { filename, text } : null)
        .catch(() => null);
    });

    const results = (await Promise.all(fetches)).filter(Boolean);

    // 3. Parse frontmatter from each file
    const loaded = [];
    for (const { filename, text } of results) {
      const fm = parseFrontmatter(text);
      if (!fm || fm.type !== 'dive') continue;
      // A file someone shared, sitting in the vault — skipped, so the two read
      // paths agree. importDivesFromFiles diverts these to _handleSharedDives;
      // this path used to adopt them silently instead, ignoring the sender's
      // stated intent AND carrying shared_intent forward into every later
      // re-serialisation of the user's own vault file. Skipping means the only
      // way in is the deliberate, gated Import — which is the point.
      if (fm.shared_intent) continue;

      // ── Strategy: parse the Marine life markdown table first.
      // It contains species, common name, count, AphiaID, and validated status —
      // far richer than the frontmatter species list. Fall back to the frontmatter
      // list (names only, count=1) only if the table isn't present.

      // 1. Try to parse the Marine life table from the markdown body
      const marineTableMatch = text.match(/## Marine life[\s\S]*?\n(\|[\s\S]*?)(?=\n## |\n---\n|$)/);
      let marineFromTable = [];

      if (marineTableMatch) {
        const tableText = marineTableMatch[1];
        // 8-col: Species | Common | Abundance | Count | AphiaID | Validated | Video | Timestamp
        // 6-col: Species | Common | Abundance | Count | AphiaID | Validated (legacy)
        // 5-col: Species | Common | Count | AphiaID | Validated (older legacy)
        const rows = tableText.match(/^\|[^\n|]+\|[^\n|]+\|[^\n|]+\|[^\n|]+\|[^\n|]+\|(?:[^\n|]+\|)*$/mg) || [];
        for (const row of rows) {
          const cells = row.split('|').map(c => c.trim()).filter(Boolean);
          if (cells.length < 5) continue;
          if (cells[0].startsWith('-') || cells[0].toLowerCase().startsWith('species')) continue;
          const sciName    = cells[0].replace(/\*/g, '').trim();
          const commonName = cells[1] === '—' ? '' : cells[1];
          const is8col     = cells.length >= 8;
          const is6col     = cells.length >= 6;
          const col2IsROC  = ['R','O','C'].includes(cells[2]);
          const abundance  = is6col ? (cells[2] === '—' ? '' : cells[2])
                                    : (col2IsROC ? cells[2] : '');
          const count      = is6col ? (parseInt(cells[3]) || null)
                                    : (col2IsROC ? null : (parseInt(cells[2]) || null));
          const aphiaId    = is6col ? (cells[4] === '—' ? null : parseInt(cells[4]) || null)
                                    : (cells[3] === '—' ? null : parseInt(cells[3]) || null);
          const validated  = is6col ? (cells[5].includes('✓') || cells[5].toLowerCase() === 'true')
                                    : (cells[4].includes('✓') || cells[4].toLowerCase() === 'true');
          const video      = is8col && cells[6] !== '—' ? cells[6] : undefined;
          const time       = is8col && cells[7] !== '—' ? cells[7] : undefined;
          if (!sciName || sciName === 'Species') continue;

          const dbMatch = SPECIES_DB.find(s =>
            s[1].toLowerCase() === sciName.toLowerCase() ||
            s[0].toLowerCase() === commonName.toLowerCase() ||
            s[0].toLowerCase() === sciName.toLowerCase()
          );

          const sighting = {
            scientificName: dbMatch ? dbMatch[1] : sciName,
            commonName:     dbMatch ? dbMatch[0] : (commonName || sciName),
            aphiaId:        aphiaId || (dbMatch ? dbMatch[2] : null),
            group:          dbMatch ? dbMatch[3] : '',
            abundance, count,
            validated:      validated || !!dbMatch
          };
          if (video) sighting.video = video;
          if (time)  sighting.time  = time;
          marineFromTable.push(sighting);
        }
      }

      // 2. If no table rows found, fall back to frontmatter species list or body species block
      if (marineFromTable.length === 0) {
        if (!fm.species || fm.species.length === 0) {
          // Old format: species block sits between closing --- and first # heading
          const bodySpeciesMatch = text.match(/^---\n[\s\S]*?\n---\n([\s\S]*?)(?=\n#)/);
          if (bodySpeciesMatch) {
            const bodyChunk = bodySpeciesMatch[1];
            if (bodyChunk.includes('species:')) {
              const speciesLines = bodyChunk.match(/^\s+-\s+"?([^"\n]+)"?/mg) || [];
              fm.species = speciesLines.map(l => l.replace(/^\s+-\s+"?|"?$/g, '').trim()).filter(Boolean);
            }
          }
        }
        // fm.species items may be plain strings (legacy) or objects (v2.0 YAML format)
        marineFromTable = (fm.species || []).map(s => {
          if (typeof s === 'string') {
            const dbMatch = SPECIES_DB.find(sp => sp[0].toLowerCase() === s.toLowerCase() || sp[1].toLowerCase() === s.toLowerCase());
            return dbMatch
              ? { scientificName: dbMatch[1], commonName: dbMatch[0], aphiaId: dbMatch[2], group: dbMatch[3], count: 1, validated: true }
              : { scientificName: s, commonName: s, aphiaId: null, group: '', count: 1, validated: false };
          }
          const sciName = s.scientific || s.common || '';
          const comName = s.common || s.scientific || '';
          const dbMatch = SPECIES_DB.find(sp =>
            sp[0].toLowerCase() === comName.toLowerCase() ||
            sp[1].toLowerCase() === sciName.toLowerCase()
          );
          const out = dbMatch
            ? { scientificName: dbMatch[1], commonName: dbMatch[0], aphiaId: dbMatch[2], group: dbMatch[3], validated: true }
            : { scientificName: sciName, commonName: comName, aphiaId: s.aphia_id || null, group: s.group || '', validated: s.validated === true };
          if (s.abundance) out.abundance = s.abundance;
          if (s.video)     out.video     = s.video;
          if (s.time)      out.time      = s.time;
          return out;
        });
      }

      const dive = frontmatterToDive(fm, filename);
      if (!dive.uid) dive.uid = mintUid();
      const fmMarine = dive.marine || []; // save before body-table overwrite — carries clips from YAML
      dive.marine = marineFromTable;

      // Restore per-clip footage data from frontmatter (body table doesn't carry it)
      dive.marine.forEach(m => {
        const fmMatch = fmMarine.find(f =>
          f.scientificName.toLowerCase() === m.scientificName.toLowerCase()
        );
        if (fmMatch && _sightingHasClips(fmMatch)) m.clips = _sightingClips(fmMatch);
      });

      // Extract notes from markdown body
      const notesMatch = text.match(/## Notes\n+([\s\S]*?)(?:\n+##|$)/);
      if (notesMatch) {
        const notesText = notesMatch[1].trim().replace(/^\*No notes recorded\.\*$/, '');
        dive.notes = notesText;
      }

      // Extract weather from Conditions table (not in frontmatter)
      const weatherMatch = text.match(/\|\s*Weather[^|]*\|\s*([^|\n]+)\|/);
      if (weatherMatch) {
        const w = weatherMatch[1].trim();
        if (w !== '—') dive.weather = w;
      }

      // Extract watertype from Conditions table
      const watertypeMatch = text.match(/\|\s*Water type[^|]*\|\s*([^|\n]+)\|/);
      if (watertypeMatch) {
        const wt = watertypeMatch[1].trim();
        if (wt && wt !== '—') dive.watertype = wt;
      }

      loaded.push(dive);
    }

    // 4. Merge pending local changes, then sort and update app state.
    // If a dive was modified locally while Obsidian was temporarily unreachable,
    // its _pendingSync flag is still true in localStorage.  Blindly replacing from
    // the vault would discard those changes (e.g. footage video links just saved).
    // Strategy: keep the local version for pending dives and fire-and-forget a
    // re-push now that we know Obsidian is reachable again.
    const _localByFilename = {};
    dives.forEach(d => { if (d._filename) _localByFilename[d._filename] = d; });
    const _pendingFilenames = new Set(
      dives.filter(d => d._pendingSync && d._filename).map(d => d._filename)
    );
    if (_pendingFilenames.size) {
      dives.filter(d => _pendingFilenames.has(d._filename))
           .forEach(d => {
             // Sidecar first (verified) for dives carrying footage — the MD
             // writer strips clips, so the MD is only rewritten once the
             // sidecar is confirmed on disk (writeSidecar !== 'fail').
             const hasFootage = (d.videos || []).length > 0 ||
               (d.marine || []).some(m => Array.isArray(m.clips) && m.clips.length > 0);
             const pre = hasFootage ? writeSidecar(d) : Promise.resolve('skip');
             pre.then(r => { if (r !== 'fail') return pushToObsidian(d); })
                .catch(() => {});
           });
    }
    // Obsidian is source of truth except for dives with unconfirmed local edits
    const _merged = loaded.map(obsDiv =>
      _pendingFilenames.has(obsDiv._filename) ? (_localByFilename[obsDiv._filename] || obsDiv) : obsDiv
    );
    dives = _merged.sort((a, b) => (parseInt(a.divenum)||0) - (parseInt(b.divenum)||0));
    _backfillRegistry(dives);
    await loadAllSidecars(dives);
    await loadAllProfileSidecars(dives);
    applyAllSidecars(dives);
    // read-repair: rebuild missing sidecars from MD clips.
    // Safe on the full array here, unlike syncFromFolder's two call sites: the
    // `dives = _merged` above is a wholesale REPLACE, so by this line the array
    // already contains only this vault's dives. syncFromFolder merges instead,
    // which is precisely why the folder path had to start filtering and this
    // one didn't. Keep that difference in mind before "tidying" the two to match.
    await migrateLegacyFootage(dives);
    migrateAbundance(); // derive abundance from count for any files without it
    localStorage.setItem('divelog-dives', JSON.stringify(dives));
    acBootstrap();
    updateCount();
    renderHistory();

    const msg = `<span class="spin"></span> Synced ${dives.length} dive${dives.length !== 1 ? 's' : ''} from Obsidian vault`;
    if (showBanner) {
      setSyncBanner('sync-banner-log', msg.replace('spin', 'obs-dot').replace('class="obs-dot"','class="obs-dot" style="background:var(--success)"'), 'success');
      setSyncBanner('sync-banner-history', msg.replace('spin', 'obs-dot').replace('class="obs-dot"','class="obs-dot" style="background:var(--success)"'), 'success');
      setTimeout(() => {
        setSyncBanner('sync-banner-log', '', '');
        setSyncBanner('sync-banner-history', '', '');
      }, 4000);
    }
    // Was `dives.length + ' dives in vault'` — see the matching comment on
    // the local-mode call above for why this duplicated .dive-count.
    setSidebarSync('Synced to vault');
    return true;

  } catch (e) {
    obsAvailable = false;
    setSidebarSync('Obsidian offline');
    if (showBanner) {
      setSyncBanner('sync-banner-log', 'Obsidian not reachable — using local cache. Open Obsidian and reload to sync.', 'warning');
      setSyncBanner('sync-banner-history', 'Obsidian not reachable — using local cache. Open Obsidian and reload to sync.', 'warning');
    }
    return false;
  }
}


// Re-push every dive in memory back to the vault, writing the current schema
// (uid, custom_id, abundance, etc.) into all files at once.
// Intended as a one-time migration tool after a schema update.
async function pushAllToObsidian(btn) {
  if (syncMode !== 'obsidian' || !obsAvailable) {
    showToast('Obsidian sync must be active and connected.', { variant: 'warning' });
    return;
  }
  const orig = btn.textContent;
  btn.disabled = true;
  btn.textContent = `Pushing 0 / ${dives.length}…`;

  let pushed = 0, failed = 0;
  for (const d of dives) {
    try {
      await pushToObsidian(d);
      pushed++;
    } catch(e) { failed++; }
    btn.textContent = `Pushing ${pushed + failed} / ${dives.length}…`;
  }

  const summary = `✓ ${pushed} updated${failed ? `, ${failed} failed` : ''}`;
  btn.textContent = summary;
  setTimeout(() => { btn.textContent = orig; btn.disabled = false; }, 4000);
}

// Coalesce pending-dot re-renders during bulk pushes (trip rename, sync-time
// re-push wave): each push re-arms the timer, so a burst of N pushes costs one
// renderHistory after the last lands instead of N full timeline rebuilds
// (each of which would also re-init the visible Leaflet trip map).
let _pushRenderTimer = null;

// Coordinated canonical renaming (BRIEF-sidecar-filename-hygiene.md): the
// canonical name is derived fresh on every push, not just used once at
// creation. If it has drifted from the recorded _filename (divenum/site
// changed since the last save), write under the new name first, then clean
// up the old .md + sidecar — never the reverse order.
async function pushToObsidian(dive) {
  const folder = (obsSettings.folder || 'Dives').replace(/\/$/, '');
  const oldFilename = dive._filename || '';
  const filename = canonicalFilename(dive);
  const path = `${folder}/${filename}`;
  const body = generateFrontmatter(dive) + '\n' + generateMD(dive);

  const res = await fetch(`${OBS_BASE}/vault/${encodeURIComponent(path)}`, {
    method: 'PUT',
    headers: obsHeaders('text/markdown'),
    body: body
  });
  // After a successful push, update the dive's _filename in local state
  if (res.ok) {
    const idx = dives.findIndex(d => d.id === dive.id);
    if (idx >= 0) {
      const renamed = !!(oldFilename && oldFilename !== filename);
      dives[idx]._filename = filename;
      dives[idx]._pendingSync = false;
      localStorage.setItem('divelog-dives', JSON.stringify(dives));
      if (renamed) await _cleanupOldDiveFiles(dives[idx], oldFilename);
      // Clear the now-stale Pending dot, but only if the history list is
      // on screen — and debounced, so bulk pushes render once, not per dive.
      const hp = document.getElementById('panel-history');
      if (hp && hp.classList.contains('active')) {
        clearTimeout(_pushRenderTimer);
        _pushRenderTimer = setTimeout(renderHistory, 250);
      }
    }
  }
  return { ok: res.ok, status: res.status, filename };
}

// Quick save from the log page MD block (saves the most recently logged dive)
let lastSavedDiveId = null;
async function quickSaveToObsidian() {
  if (!lastSavedDiveId) { showToast('Save a dive first.', { variant: 'warning' }); return; }
  const dive = dives.find(d => d.id === lastSavedDiveId);
  if (!dive) return;
  const btn = document.getElementById('obs-quick-btn');
  btn.textContent = 'Saving…';
  try {
    const { ok, filename } = await pushToObsidian(dive);
    btn.textContent = ok ? '✓ Saved' : '✗ Failed';
    btn.style.color = ok ? 'var(--success)' : 'var(--danger)';
    setTimeout(() => { btn.textContent = 'Save to Obsidian'; btn.style.color = ''; }, 3000);
  } catch(e) {
    btn.textContent = '✗ Obsidian offline';
    btn.style.color = 'var(--danger)';
    setTimeout(() => { btn.textContent = 'Save to Obsidian'; btn.style.color = ''; }, 3000);
  }
}


