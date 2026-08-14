// Bump on EVERY shell-file edit during a live local-testing session, not
// just once per release batch: a tester's browser installs the SW on first
// page load and then serves shell files from that cache — an edit without a
// bump never reaches them, no matter what the dev server has on disk. This
// exact miss burned two real dive-computer hardware sessions on 2026-07-14
// (a fix shipped mid-session without a bump; both retests ran the old bytes).
const CACHE = 'divelog-v324';
// Required for the app to function — cached atomically (all-or-nothing, see
// fetchShellFile below). Kept deliberately free of large decorative assets:
// this set gates activation, so its total size is a direct reliability
// bound on a weak mobile connection.
// NOTE: '/' is the canonical cache key for the app shell — '/index.html'
// must NEVER be in this list. Cloudflare Pages answers /index.html with a
// 308 redirect to / (its clean-URL behaviour), and cacheable() rejects any
// redirected response (the Access login-page guard, below) — so fetching
// /index.html fails deterministically IN PRODUCTION ONLY (local dev servers
// serve it as a plain 200, which is why local testing never caught it),
// permanently failing every install. See DECISIONS.md.
// vendor/libdivecomputer-wasm/* (BRIEF-dive-computer-sync.md) joins this
// list, not SHELL_DEFERRED, despite its size (~380KB combined) — the
// Literata fonts earned DEFERRED because css/styles.css has a Georgia
// fallback; there is no fallback for a Sync tap while offline, which is
// precisely the scenario this feature exists for (a dive site with no
// signal). A cache-miss here means a hard error at the worst possible
// moment, not a lesser aesthetic — same reasoning that already puts
// Leaflet/scuba-physics here despite also being lazy-loaded, not eager.
const SHELL_CRITICAL = ['/', '/manifest.json', '/favicon-32.png', '/favicon-192.png', '/favicon-512.png', '/apple-touch-icon.png', '/data/species-db.js', '/css/styles.css', '/js/autocomplete.js', '/js/map.js', '/js/markdown.js', '/js/obsidian.js', '/js/stats.js', '/js/species.js', '/js/history.js', '/js/app.js', '/js/logform.js', '/js/footage.js', '/js/video.js', '/js/footage-match.js', '/js/chart-math.js', '/js/profile.js', '/js/computer-sync.js', '/js/album.js', '/js/planner.js', '/vendor/leaflet/leaflet.js', '/vendor/leaflet/leaflet.css', '/vendor/leaflet/images/layers.png', '/vendor/leaflet/images/layers-2x.png', '/vendor/leaflet/images/marker-icon.png', '/vendor/leaflet/images/marker-icon-2x.png', '/vendor/leaflet/images/marker-shadow.png', '/vendor/scuba-physics/scuba-physics.min.js', '/vendor/libdivecomputer-wasm/download.mjs', '/vendor/libdivecomputer-wasm/download.wasm', '/fonts/Figtree-VariableFont_wght.ttf', '/fonts/Figtree-Italic-VariableFont_wght.ttf', '/fonts/YoungSerif-Regular.ttf'];
// Decorative only (the Notes journal serif) — cached best-effort, never
// blocks install/activation. css/styles.css already declares a Georgia
// fallback for --serif, so the app looks and works fine without these
// until they finish caching (this visit or a later one). At ~1.8MB combined
// (Literata's variable-weight regular + italic TTFs), these were over half
// of the entire shell's download weight — see DECISIONS.md.
// THIRD-PARTY-NOTICES.txt joins DEFERRED, not CRITICAL: it's ~110KB of
// attribution text behind a collapsed Settings disclosure, and the app is
// fully usable without it. Cached best-effort so it still opens offline.
const SHELL_DEFERRED = ['/fonts/Literata-VariableFont_opsz,wght.ttf', '/fonts/Literata-Italic-VariableFont_opsz,wght.ttf', '/THIRD-PARTY-NOTICES.txt', '/LICENSE.md'];

// A response is only cacheable if it's a real 200 from OUR origin. Behind
// Cloudflare Access, an expired session turns any fetch into a redirect to
// the HTML login page — blindly caching that poisons the shell (assets served
// as text/html forever). res.redirected catches the Access bounce.
function cacheable(res) {
  return res && res.ok && !res.redirected &&
         new URL(res.url).origin === self.location.origin;
}

// Fetch one shell file, retrying a transient failure (weak mobile signal —
// a timeout or dropped connection, not a bad response) a few times before
// giving up. A non-cacheable response (redirect/non-200 — see cacheable())
// is a real failure, not a blip, so it's NOT retried.
async function fetchShellFile(path, tries = 3) {
  let lastErr;
  for (let attempt = 0; attempt < tries; attempt++) {
    try {
      const res = await fetch(path, { credentials: 'same-origin' });
      if (!cacheable(res)) throw new Error('not cacheable: ' + path);
      return res;
    } catch (e) {
      lastErr = e;
      if (attempt < tries - 1) await new Promise(r => setTimeout(r, 400 * (attempt + 1)));
    }
  }
  throw lastErr;
}

self.addEventListener('install', e => {
  // Critical shell: fetch it ALL into memory before writing anything to
  // the cache. Manual fetch+put instead of cache.addAll (addAll caches
  // redirects/login pages without complaint) is unchanged; what's new is
  // *when* the writes happen. The old code opened the cache first and
  // wrote each file as its own fetch resolved — Promise.all rejecting on
  // one bad/flaky file doesn't undo the c.put() calls that already landed
  // for the OTHER files, so a single transient failure on a weak mobile
  // connection left a permanently half-cached shell (e.g. index.html
  // present, styles.css missing) sitting in Cache Storage — it survives a
  // failed install and gets silently reopened (not recreated) by the next
  // attempt, since CACHE is a fixed name. Gathering every response first
  // means nothing is written to the cache at all unless every critical
  // file — with its own retries — succeeded, so a still-failing install
  // now leaves NO cache for this version rather than a broken partial one.
  e.waitUntil(
    Promise.all(SHELL_CRITICAL.map(path => fetchShellFile(path).then(res => [path, res])))
      .then(pairs => caches.open(CACHE).then(c => Promise.all(pairs.map(([path, res]) => c.put(path, res)))))
      .then(() => self.skipWaiting())
  );
  // Deferred shell: best-effort, independent of the above. A failure here
  // is caught and logged, never rejected — it must NEVER fail install or
  // delay activation. Each file is cached as soon as its own fetch
  // succeeds; there's nothing atomic to preserve since the app already
  // tolerates any subset of these being missing.
  e.waitUntil(
    Promise.all(SHELL_DEFERRED.map(path =>
      fetchShellFile(path)
        .then(res => caches.open(CACHE).then(c => c.put(path, res)))
        .catch(err => console.warn('deferred shell file failed (non-fatal):', path, err))
    ))
  );
});

self.addEventListener('activate', e => {
  // Delete any old cache versions
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Only intercept OUR origin. Cross-origin (OSM tiles, iNat photos, APIs,
  // Obsidian loopback) goes straight to the browser: the page's CSP governs
  // it, not the worker's, and opaque responses were never cacheable anyway.
  if (url.origin !== self.location.origin) return;

  // Navigation requests: serve the cached shell ('/' — the canonical key,
  // see SHELL_CRITICAL's note) immediately, revalidate in background — but
  // never cache a redirect/login page over the real app.
  if (e.request.mode === 'navigate') {
    e.respondWith(
      caches.match('/').then(cached => {
        const network = fetch(e.request).then(res => {
          if (cacheable(res)) {
            const copy = res.clone();
            caches.open(CACHE).then(c => c.put('/', copy));
          }
          return res;
        });
        return cached || network;
      })
    );
    return;
  }

  // Everything else: cache first, network fallback
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});
