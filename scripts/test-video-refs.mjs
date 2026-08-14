#!/usr/bin/env node
// Tests for the video ref model (js/video.js) — relative-path refs.
//
// The property under test: two videos that share a filename but live in
// different connected folders must resolve to DIFFERENT files. That is the
// collision BRIEF-footage-cloud-hosting.md §2.3 predicted would be amplified
// by v2.98's recursive scan, and the reason refs had to stop being bare
// filenames before any cloud ref is written.
//
// Legacy refs (bare filenames, everything written before v2.982) must keep
// resolving via the stem fallback, since old sidecars are never rewritten.
//
// Run: node scripts/test-video-refs.mjs   (from anywhere)

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, '..', 'js', 'video.js'), 'utf8');

// Pull just the pure helpers + the resolver out of video.js. Loading the whole
// file would drag in Tauri/DOM/localStorage globals that don't exist here.
function extract(name, kind = 'function') {
  const start = src.indexOf(`${kind} ${name}(`);
  if (start === -1) throw new Error(`could not find ${kind} ${name}(`);
  let i = src.indexOf('{', start), depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(start, i + 1); }
  }
  throw new Error(`unbalanced braces in ${name}`);
}

const ctx = {
  _proxyUrls: new Map(),
  _proxyPathUrls: new Map(),
  console,
};
vm.createContext(ctx);
vm.runInContext(
  [extract('_fileStem'), extract('_normRel'), extract('_isPathRef'), extract('_resolveLocalUrl')].join('\n'),
  ctx
);

let pass = 0, fail = 0;
const ok = (cond, label) => {
  if (cond) { pass++; console.log('  PASS  ' + label); }
  else { fail++; console.log('  FAIL  ' + label); }
};
const eq = (got, want, label) =>
  ok(got === want, `${label}${got === want ? '' : `  (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`}`);

// ── _normRel ────────────────────────────────────────────────────────────────
console.log('\n_normRel — canonical key form');
eq(ctx._normRel('Komodo/dive-1/GX010128.MP4'), 'komodo/dive-1/gx010128.mp4', 'lowercases');
eq(ctx._normRel('Komodo\\dive-1\\GX01.MP4'), 'komodo/dive-1/gx01.mp4', 'folds backslashes');
eq(ctx._normRel('./Komodo/a.mp4'), 'komodo/a.mp4', 'strips leading ./');
eq(ctx._normRel('/Komodo/a.mp4'), 'komodo/a.mp4', 'strips leading /');
eq(ctx._normRel(''), '', 'empty is safe');
eq(ctx._normRel(null), '', 'null is safe');
ok(ctx._normRel('a/b.mp4') !== ctx._fileStem('a/b.mp4'), 'keeps extension (unlike _fileStem)');

console.log('\n_isPathRef — distinguishes new refs from legacy ones');
ok(ctx._isPathRef('Komodo/dive-1/GX010128.MP4'), 'path ref detected');
ok(ctx._isPathRef('Komodo\\dive-1\\GX01.MP4'), 'windows-separator path ref detected');
ok(!ctx._isPathRef('GX010128.MP4'), 'bare filename is not a path ref');
ok(!ctx._isPathRef(''), 'empty is not a path ref');

// ── The collision this whole change exists to fix ───────────────────────────
// Two trips, each with a dive-1 folder, each holding GX010128.MP4.
console.log('\nTHE COLLISION — same filename, two connected trip folders');
ctx._proxyPathUrls.set('komodo-2026/dive-1/gx010128.mp4', { name: 'GX010128.MP4', url: 'url:komodo' });
ctx._proxyPathUrls.set('egypt-2025/dive-1/gx010128.mp4',   { name: 'GX010128.MP4', url: 'url:egypt' });
// Stem map can only hold one winner for a shared stem — last scan wins.
ctx._proxyUrls.set('gx010128', { name: 'GX010128.MP4', url: 'url:egypt' });

eq(ctx._resolveLocalUrl('Komodo-2026/dive-1/GX010128.MP4'), 'url:komodo', 'komodo path ref → komodo file');
eq(ctx._resolveLocalUrl('Egypt-2025/dive-1/GX010128.MP4'), 'url:egypt', 'egypt path ref → egypt file');
ok(ctx._resolveLocalUrl('Komodo-2026/dive-1/GX010128.MP4')
   !== ctx._resolveLocalUrl('Egypt-2025/dive-1/GX010128.MP4'),
   'the two DO NOT collide (this is the bug being fixed)');
// The legacy behaviour, unchanged and still ambiguous — documented, not fixed:
eq(ctx._resolveLocalUrl('GX010128.MP4'), 'url:egypt',
   'bare legacy ref still resolves (to the stem winner — ambiguous by design)');

console.log('\ncase / separator insensitivity of path refs');
eq(ctx._resolveLocalUrl('komodo-2026/DIVE-1/gx010128.mp4'), 'url:komodo', 'case-insensitive');
eq(ctx._resolveLocalUrl('Komodo-2026\\dive-1\\GX010128.MP4'), 'url:komodo', 'backslash-separated');

// ── Fallback ordering ───────────────────────────────────────────────────────
console.log('\nfallback — path miss falls through to stem');
// A path ref for a file the current scan does not have at that path, but whose
// stem IS present (e.g. folder re-organised since the ref was written).
eq(ctx._resolveLocalUrl('Somewhere-Else/dive-9/GX010128.MP4'), 'url:egypt',
   'unknown path falls back to stem rather than failing outright');
eq(ctx._resolveLocalUrl('NoSuchFile.MP4'), null, 'genuinely absent ref → null');
eq(ctx._resolveLocalUrl(''), null, 'empty ref → null');
eq(ctx._resolveLocalUrl(null), null, 'null ref → null');

console.log('\nproxy preference still works through the stem map');
// The proxy of an original lives at a different path, related only by stem —
// _proxyUrls' proxy-wins tie-break is what makes the stem step find it.
ctx._proxyPathUrls.clear(); ctx._proxyUrls.clear();
ctx._proxyPathUrls.set('trip/dive-1/gx99.mp4', { name: 'GX99.MP4', url: 'url:original' });
ctx._proxyPathUrls.set('trip/proxies/gx99.mp4', { name: 'GX99.mp4', url: 'url:proxy' });
ctx._proxyUrls.set('gx99', { name: 'GX99.mp4', url: 'url:proxy' }); // proxy won the tie-break
eq(ctx._resolveLocalUrl('Trip/dive-1/GX99.MP4'), 'url:original',
   'an exact path ref resolves to that exact file, proxy or not');
eq(ctx._resolveLocalUrl('GX99.MP4'), 'url:proxy',
   'a bare ref still prefers the proxy via the stem tie-break');

// ── Empty-state safety ──────────────────────────────────────────────────────
console.log('\nno folder connected');
ctx._proxyPathUrls.clear(); ctx._proxyUrls.clear();
eq(ctx._resolveLocalUrl('Trip/dive-1/GX99.MP4'), null, 'path ref → null with no scan');
eq(ctx._resolveLocalUrl('GX99.MP4'), null, 'bare ref → null with no scan');

console.log(`\nVIDEO REFS: ${fail === 0 ? 'PASS' : 'FAIL'}  (${pass} passed, ${fail} failed)`);
process.exit(fail === 0 ? 0 : 1);
