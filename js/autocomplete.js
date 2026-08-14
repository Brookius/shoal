// Autocomplete cache engine — extracted from index.html (modular migration, step 3).
// Classic script loaded before the main inline script (shared global scope).
// NOTE: only DEFINITIONS live here. The load-time `acBootstrap();` call stays
// in the inline script (it needs `dives`, defined there at load).
// ── Autocomplete cache engine ─────────────────────────────────────────────
// Stores unique values per field key in localStorage
// Keys: suit, weight, tanksize, liveaboard, buddy, instructor, region, trip

const AC_STORE_KEY = 'divelog-ac-cache';
let acCache = JSON.parse(localStorage.getItem(AC_STORE_KEY) || '{}');

function acSave(key, value) {
  if (!value || String(value).trim() === '') return;
  const v = String(value).trim();
  if (!acCache[key]) acCache[key] = [];
  // Move to front if exists, otherwise prepend
  acCache[key] = [v, ...acCache[key].filter(x => x.toLowerCase() !== v.toLowerCase())].slice(0, 20);
  localStorage.setItem(AC_STORE_KEY, JSON.stringify(acCache));
}

function acGetMatches(key, query) {
  const list = acCache[key] || [];
  if (!query) return list.slice(0, 8);
  const q = query.toLowerCase();
  return list.filter(v => v.toLowerCase().includes(q)).slice(0, 8);
}

let acFocusedIndex = -1;
let acActiveId = null;

function acInput(inputEl, cacheKey) {
  const ddId = 'ac-' + inputEl.id;
  const dd = document.getElementById(ddId);
  if (!dd) return;
  acActiveId = inputEl.id;
  acFocusedIndex = -1;
  const matches = acGetMatches(cacheKey, inputEl.value);
  if (!matches.length) { dd.style.display = 'none'; return; }
  dd.innerHTML = matches.map((m, i) =>
    `<div class="ac-option" data-i="${i}" data-val="${esc(m)}"
      onmousedown="acSelect('${inputEl.id}','${cacheKey}',this)">${esc(m)}</div>`
  ).join('');
  dd.style.display = 'block';
}

function acSelect(inputId, cacheKey, optionEl) {
  const input = document.getElementById(inputId);
  if (!input) return;
  input.value = optionEl.dataset.val;
  const dd = document.getElementById('ac-' + inputId);
  if (dd) dd.style.display = 'none';
  acFocusedIndex = -1;
}

function acBlur(inputId) {
  // Small delay so mousedown on option fires first
  setTimeout(() => {
    const dd = document.getElementById('ac-' + inputId);
    if (dd) dd.style.display = 'none';
  }, 150);
}

function acKey(e, inputId) {
  const dd = document.getElementById('ac-' + inputId);
  if (!dd || dd.style.display === 'none') return;
  const opts = dd.querySelectorAll('.ac-option');
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    acFocusedIndex = Math.min(acFocusedIndex + 1, opts.length - 1);
    opts.forEach((o, i) => o.classList.toggle('ac-focused', i === acFocusedIndex));
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    acFocusedIndex = Math.max(acFocusedIndex - 1, 0);
    opts.forEach((o, i) => o.classList.toggle('ac-focused', i === acFocusedIndex));
  } else if (e.key === 'Enter' && acFocusedIndex >= 0) {
    e.preventDefault();
    opts[acFocusedIndex].dispatchEvent(new MouseEvent('mousedown'));
  } else if (e.key === 'Escape') {
    dd.style.display = 'none';
  }
}

// Save values from a completed dive to the cache
function acSaveDiveFields(dive) {
  if (dive.suit)       acSave('suit',        dive.suit);
  if (dive.weight)     acSave('weight',       String(dive.weight));
  if (dive.tanksize)   acSave('tanksize',     String(dive.tanksize));
  if (dive.liveaboard) acSave('liveaboard',   dive.liveaboard);
  if (dive.buddy)      acSave('buddy',        dive.buddy);
  if (dive.signoff)    acSave('instructor',   dive.signoff);
  if (dive.region)     acSave('region',       dive.region);
  if (dive.trip)       acSave('trip',         dive.trip);
}

// Also build cache from existing dives on first load
function acBootstrap() {
  dives.forEach(d => acSaveDiveFields(d));
}
