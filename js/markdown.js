// Markdown / frontmatter transforms — extracted from index.html (modular migration, step 5).
// Classic script, loaded before the main inline script (shared global scope).
// Pure transforms: no DOM. SPECIES_DB is available (data/species-db.js loads first).
// v2.0: parseFrontmatter handles YAML object-lists (videos[], species objects);
//       generateFrontmatter emits multi-object species + videos block;
//       frontmatterToDive reads videos[] and per-sighting video/time.

// ── Stable identity ───────────────────────────────────────────────────────
// Mint a stable, immutable dive uid. Format: dl_<7 base-36 chars>.
// Called on first save of any dive; never derived from filename or date.
function mintUid() {
  return 'dl_' + Math.random().toString(36).slice(2, 9);
}

// Mint a stable custom-species id. Format: cs_<4 base-36 chars>.
// Minted once per unique free-text name; stored on the sighting in the dive MD.
function mintCustomId() {
  return 'cs_' + Math.random().toString(36).slice(2, 6);
}

// ── FRONTMATTER PARSER ────────────────────────────────────────────────────
// Parses YAML frontmatter from a markdown string into a plain object.
// Handles strings, numbers, booleans, simple lists (- item), and
// object lists (- key: val\n  key: val) used by species and videos blocks.
function parseFrontmatter(mdText) {
  const match = mdText.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;
  const yaml = match[1];
  const result = {};
  let currentKey = null;
  let inList     = false;
  let objectList = false; // true when current list items are objects, not plain strings
  let inSubList  = false; // true when inside a nested list within an object item (e.g. clips:)
  let subListKey = null;  // the key on the parent object that holds the sub-list

  function parseScalar(raw) {
    const s = raw.replace(/^["']|["']$/g, '').trim();
    if (s === 'true')              return true;
    if (s === 'false')             return false;
    if (s === 'null' || s === '~') return null;
    return (s !== '' && !isNaN(s)) ? Number(s) : s;
  }

  for (const line of yaml.split('\n')) {
    // Sub-list field continuation: key:value at 8+ spaces inside a sub-list item
    if (inList && objectList && inSubList && /^\s{8,}[\w_]+:/.test(line) && !/^\s+-\s+/.test(line)) {
      const kv = line.match(/^\s+([\w_]+):\s*(.*)/);
      if (kv) {
        const parent = result[currentKey][result[currentKey].length - 1];
        if (parent && typeof parent === 'object' && Array.isArray(parent[subListKey])) {
          const subItems = parent[subListKey];
          if (subItems.length > 0) {
            const lastSub = subItems[subItems.length - 1];
            if (lastSub && typeof lastSub === 'object') lastSub[kv[1]] = parseScalar(kv[2]);
          }
        }
      }
      continue;
    }

    // Sub-list item: `      - key: value` at 6+ spaces inside an object-list item
    if (inList && objectList && inSubList && /^\s{6,}-\s+/.test(line)) {
      const rest    = line.replace(/^\s+-\s+/, '').trim();
      const kvMatch = rest.match(/^([\w_]+):\s*(.*)/);
      const parent  = result[currentKey][result[currentKey].length - 1];
      if (parent && typeof parent === 'object' && Array.isArray(parent[subListKey])) {
        if (kvMatch) {
          const subObj = {};
          subObj[kvMatch[1]] = parseScalar(kvMatch[2]);
          parent[subListKey].push(subObj);
        }
      }
      continue;
    }

    // Object-list continuation: deeper-indented key:value, no leading dash
    if (inList && objectList && /^\s{4,}[\w_]+:/.test(line) && !/^\s+-\s+/.test(line)) {
      const kv = line.match(/^\s+([\w_]+):\s*(.*)/);
      if (kv && result[currentKey].length > 0) {
        const obj = result[currentKey][result[currentKey].length - 1];
        if (obj && typeof obj === 'object') {
          const trimmedVal = kv[2].trim();
          if (trimmedVal === '' || trimmedVal === '[]') {
            // Empty value → this key introduces a sub-list (e.g. clips:)
            obj[kv[1]] = [];
            subListKey  = kv[1];
            inSubList   = true;
          } else {
            obj[kv[1]] = parseScalar(kv[2]);
            inSubList   = false;
            subListKey  = null;
          }
        }
        continue;
      }
    }

    // List item (main-list level — resets any sub-list context)
    if (inList && /^\s+-\s+/.test(line)) {
      inSubList  = false;
      subListKey = null;
      const rest    = line.replace(/^\s+-\s+/, '').trim();
      const kvMatch = rest.match(/^([\w_]+):\s*(.*)/);
      if (kvMatch) {
        // Object-style item — first field of a new object
        objectList = true;
        const obj  = {};
        obj[kvMatch[1]] = parseScalar(kvMatch[2]);
        result[currentKey].push(obj);
      } else {
        // Plain string item
        objectList = false;
        result[currentKey].push(parseScalar(rest));
      }
      continue;
    }

    // Leaving list context
    inList     = false;
    objectList = false;
    inSubList  = false;
    subListKey = null;

    // Top-level key: value
    const kv = line.match(/^([\w_]+):\s*(.*)/);
    if (!kv) continue;
    const [, key, raw] = kv;
    const trimmed = raw.trim();
    if (trimmed === '' || trimmed === '[]') {
      result[key] = [];
      currentKey  = key;
      inList      = true;
    } else if (trimmed.startsWith('[')) {
      result[key] = trimmed.slice(1, -1).split(',').map(s => parseScalar(s.trim()));
    } else {
      result[key] = parseScalar(trimmed);
      currentKey  = null;
    }
  }
  return result;
}

// Convert a parsed frontmatter object into the app's internal dive shape.
// marine[] is populated with full objects when species items are objects
// (new format) or plain strings (legacy). Caller (syncFromObsidian) may
// override marine[] with richer data from the markdown body table.
function frontmatterToDive(fm, filename) {
  // Generate a stable numeric id from the filename so edits don't create duplicates
  let id = 0;
  for (let i = 0; i < filename.length; i++) id = (id * 31 + filename.charCodeAt(i)) >>> 0;
  id = id || Date.now();

  // Reconstruct marine sightings from the species list (new object format or legacy strings)
  const marine = Array.isArray(fm.species) ? fm.species.map(s => {
    if (typeof s === 'string') {
      // Legacy: plain name string
      const db = SPECIES_DB.find(sp =>
        sp[0].toLowerCase() === s.toLowerCase() ||
        sp[1].toLowerCase() === s.toLowerCase()
      );
      return db
        ? { scientificName: db[1], commonName: db[0], aphiaId: db[2], group: db[3], validated: true }
        : { scientificName: s, commonName: s, aphiaId: null, group: '', validated: false };
    }
    // New object format
    const db = SPECIES_DB.find(sp =>
      (s.scientific && sp[1].toLowerCase() === s.scientific.toLowerCase()) ||
      (s.common     && sp[0].toLowerCase() === s.common.toLowerCase())
    );
    const out = {
      scientificName: db ? db[1] : (s.scientific || s.common || ''),
      commonName:     db ? db[0] : (s.common     || s.scientific || ''),
      aphiaId:        s.aphia_id  || (db ? db[2] : null),
      group:          db ? db[3]  : (s.group || ''),
      abundance:      s.abundance || '',
      validated:      s.validated === true || !!db,
      ...(s.custom_id ? { customId: s.custom_id } : {}),
    };
    if (Array.isArray(s.clips)) {
      out.clips = s.clips.map(c => ({
        video: c.video || '',
        ...(c.time ? { time: c.time } : {}),
        ...(c.note ? { note: c.note } : {}),
      }));
    } else if (s.video) {
      const clip = { video: s.video };
      if (s.time) clip.time = s.time;
      out.clips = [clip];
    } else {
      out.clips = [];
    }
    return out;
  }) : [];

  // Reconstruct videos array — modified stored as ISO string in YAML, ms in memory
  const videos = Array.isArray(fm.videos) ? fm.videos.map(v => {
    if (!v || typeof v !== 'object') return null;
    const mod = v.modified
      ? (typeof v.modified === 'number' ? v.modified : new Date(v.modified).getTime())
      : 0;
    return { file: v.file || '', modified: mod, size: v.size || 0, reviewed: !!v.reviewed };
  }).filter(Boolean) : [];

  // Import-boundary hardening (2.391): imported YAML is untrusted — a shared
  // .md could carry HTML in "numeric" fields (max_depth: <img onerror=…>).
  // Coercing shape here secures every downstream render site permanently.
  // Free-text fields (site, notes, names…) stay raw and are esc()'d at render.
  const num  = v => { const n = parseFloat(v); return isNaN(n) ? '' : n; };
  const hhmm = v => /^\d{1,2}:\d{2}$/.test(String(v ?? '').trim()) ? String(v).trim() : '';
  const ymd  = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v ?? '').trim()) ? String(v).trim() : '';

  return {
    id,
    uid:        /^dl_[a-z0-9]+$/i.test(fm.uid || '') ? fm.uid : null,
    divenum:    num(fm.dive_number),
    date:       ymd(fm.date),
    site:       fm.site        || '',
    location:   fm.country     || '',
    region:     fm.region      || '',
    watertype:  'Salt',
    vis:        num(fm.visibility),
    temp:       num(fm.water_temp),
    current:    fm.current     || '',
    weather:    '',
    depth:      num(fm.max_depth),
    avgdepth:   num(fm.avg_depth),
    time:       num(fm.bottom_time),
    entrytime:  hhmm(fm.entry_time),
    exittime:   hhmm(fm.exit_time),
    entry:      fm.dive_type   || '',
    pstart:     num(fm.start_pressure),
    pend:       num(fm.end_pressure),
    gas:        fm.gas         || '',
    suit:       fm.suit        || '',
    weight:     num(fm.weight),
    buddy:      fm.buddy       || '',
    liveaboard: fm.liveaboard  || '',
    trip:       fm.trip        || '',
    signoff:    fm.instructor  || '',
    certnum:    fm.cert_number || '',
    gps_lat:    (function(v){ const n=parseFloat(v); return isNaN(n)?null:n; })(fm.gps_lat),
    gps_lng:    (function(v){ const n=parseFloat(v); return isNaN(n)?null:n; })(fm.gps_lng),
    safety_stop_depth: (function(v){ const n=parseFloat(v); return isNaN(n)?null:n; })(fm.safety_stop_depth),
    safety_stop_time:  (function(v){ const n=parseFloat(v); return isNaN(n)?null:n; })(fm.safety_stop_time),
    deco_stop_depth:   (function(v){ const n=parseFloat(v); return isNaN(n)?null:n; })(fm.deco_stop_depth),
    deco_stop_time:    (function(v){ const n=parseFloat(v); return isNaN(n)?null:n; })(fm.deco_stop_time),
    title:      typeof fm.title === 'string' ? fm.title.trim() : '',
    notes:      '',
    marine,
    videos,
    _filename:  filename  // store filename so we can update the right file on edit
  };
}

// ── MARKDOWN GENERATOR ────────────────────────────────────────────────────
function generateFrontmatter(d) {
  // Quote a free-text value for a YAML double-quoted scalar. Neutralises the
  // closing quote AND strips CR/LF: a newline in a free-text field would break
  // out of the scalar and inject arbitrary frontmatter keys / corrupt the file
  // on the next parse (security review F4). Tabs collapse to a space too.
  const yamlStr = v => String(v ?? '').replace(/[\r\n\t]+/g, ' ').replace(/"/g, "'");

  // Species block — multi-object format (common/scientific/abundance/validated/customId).
  // clips and videos are NOT written here — they live in the sidecar (v2.33+).
  // Omit the block entirely when empty (keeps .md files clean).
  const speciesYaml = (d.marine || []).length ? (() => {
    const lines = (d.marine).map(m => {
      if (typeof m === 'string') {
        return `  - common: "${yamlStr(m)}"\n    scientific: "${yamlStr(m)}"`;
      }
      const rows = [
        `  - common: "${yamlStr(m.commonName)}"`,
        `    scientific: "${yamlStr(m.scientificName)}"`,
      ];
      if (m.aphiaId)   rows.push(`    aphia_id: ${m.aphiaId}`);
      if (m.group)     rows.push(`    group: "${yamlStr(m.group)}"`);
      if (m.abundance) rows.push(`    abundance: "${yamlStr(m.abundance)}"`);
      rows.push(`    validated: ${m.validated ? 'true' : 'false'}`);
      if (m.customId)  rows.push(`    custom_id: ${m.customId}`);
      // clips and videos are no longer written to the MD — they live in the sidecar (v2.33+)
      return rows.join('\n');
    });
    return '\nspecies:\n' + lines.join('\n');
  })() : '';

  // videos[] and clips are written to the sidecar (v2.33+), not the MD.

  const tagCountry = d.location ? d.location.toLowerCase().replace(/\s+/g,'-') : '';
  const tagGas     = d.gas      ? d.gas.toLowerCase().replace(/\s+/g,'-')      : '';
  const tagParts   = ['dive', tagCountry, tagGas].filter(Boolean);

  const lines = [
    '---',
    `type: dive`,
    ...(d.uid ? [`uid: ${d.uid}`] : []),
    ...(d.title ? [`title: "${yamlStr(d.title)}"`] : []),
    `dive_number: ${d.divenum || ''}`,
    `date: ${d.date || ''}`,
    `site: "${yamlStr(d.site)}"`,
    `country: "${yamlStr(d.location)}"`,
    `region: "${yamlStr(d.region)}"`,
    `max_depth: ${d.depth || ''}`,
    `avg_depth: ${d.avgdepth || ''}`,
    `bottom_time: ${d.time || ''}`,
    `entry_time: "${yamlStr(d.entrytime)}"`,
    `exit_time: "${yamlStr(d.exittime)}"`,
    `dive_type: "${yamlStr(d.entry)}"`,
    `visibility: ${d.vis || ''}`,
    `water_temp: ${d.temp || ''}`,
    `current: "${yamlStr(d.current)}"`,
    `gas: "${yamlStr(d.gas)}"`,
    `start_pressure: ${d.pstart || ''}`,
    `end_pressure: ${d.pend || ''}`,
    `suit: "${yamlStr(d.suit)}"`,
    `weight: ${d.weight || ''}`,
    `tank_type: "${yamlStr(d.tanktype)}"`,
    `tank_size: ${d.tanksize || ''}`,
    `buddy: "${yamlStr(d.buddy)}"`,
    `liveaboard: "${yamlStr(d.liveaboard)}"`,
    `trip: "${yamlStr(d.trip)}"`,
    `instructor: "${yamlStr(d.signoff)}"`,
    `cert_number: "${yamlStr(d.certnum)}"`,
    `gps_lat: ${d.gps_lat || ''}`,
    `gps_lng: ${d.gps_lng || ''}`,
    `safety_stop_depth: ${d.safety_stop_depth ?? ''}`,
    `safety_stop_time: ${d.safety_stop_time ?? ''}`,
    `deco_stop_depth: ${d.deco_stop_depth ?? ''}`,
    `deco_stop_time: ${d.deco_stop_time ?? ''}`,
    `tags: [${tagParts.map(t => '"' + t + '"').join(', ')}]`,
    speciesYaml,
    '---',
    ''
  ];
  return lines.join('\n');
}
