// Grainflow's service worker: the app opens in a paddock with no signal.
//
// This is the second attempt. The first one cost an afternoon: it cached the
// app shell and then served version 74 to a phone for hours after 75 shipped,
// while the Settings screen cheerfully reported 74 and nobody could work out
// why the new code was not arriving. It was deleted rather than fixed, and the
// app has been running with no offline support since.
//
// So the design starts from that failure rather than from the happy path. Three
// rules, and everything else follows from them:
//
//   1. The cache is named after the build. A new version cannot read the old
//      version's cache, so stale code has nowhere to hide. Activate deletes
//      every cache that is not the current one.
//
//   2. index.html is never served from cache while there is a network. It is
//      the one file with no ?v= on its own URL, so it is the only thing that
//      can tell a device a new build exists. Cache it and the device is
//      marooned on whatever it has — which is precisely what happened.
//
//   3. The server's data is never cached. Not once, not briefly. A stale
//      paddock is worse than no paddock: the numbers look right and are not.
//      Supabase requests go to the network and are never written to a cache.
//
// The version arrives in this script's own URL — main.js registers it as
// sw.js?v=<APP_VERSION> — so there is one source of truth for the build number
// and it is version.js, same as everywhere else. It also means the script
// itself is a new URL every release, which is what makes the browser install it.

const VERSION = new URL(self.location.href).searchParams.get('v') || 'dev';
const CACHE_NAME = `grainflow-${VERSION}`;

// Third-party module code. Kept out of the versioned cache on purpose: these
// URLs are immutable and re-downloading a megabyte of supabase-js on every
// release would make each update slower than the one before it.
const VENDOR_CACHE = 'grainflow-vendor';

// The minimum needed to paint something. Everything else — the thirty-odd
// modules, the icons — arrives through runtime caching on the first online
// visit, because main.js imports the whole graph eagerly and so one load
// fetches the lot. Listing them here instead would be a second copy of the
// module list to keep in step with the first, and that is how this codebase
// ended up accepting a fill state the app never writes.
const SHELL = ['./', './index.html', `./css/styles.css?v=${VERSION}`, './manifest.webmanifest'];

/**
 * What to do with one request. Pure, and exported to the tests via the source
 * rather than restated there, because getting this wrong is not a rendering
 * glitch — it is either stale code or stale tonnages.
 *
 *   network-only    go to the network, cache nothing, ever
 *   network-first   network, falling back to the cache when there is no signal
 *   cache-first     cache, falling back to the network
 *   revalidate      cache immediately, refresh in the background for next time
 */
function chooseStrategy({ url, method = 'GET', mode = '', origin = '' }) {
  // A cache can only hold GETs; cache.put() throws on anything else. Beyond the
  // mechanics, a POST is someone writing something down and must not be
  // answered from a store.
  if (method !== 'GET') return 'network-only';

  let u;
  try { u = new URL(url); } catch { return 'network-only'; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return 'network-only';

  // Rule 3, and it comes first among the host rules on purpose. Every Supabase
  // host — the REST API, auth, storage — goes straight through and is never
  // written anywhere.
  //
  // Today the generic cross-origin rule below would catch these anyway, which
  // made this line look redundant; a sabotage test that deleted it found
  // nothing wrong. It is not redundant, it is early. The plausible next change
  // to this function is caching photos for offline viewing, and those live at
  // *.supabase.co too — at which point whether the farm's tonnages get cached
  // comes down to which branch is reached first. This one is.
  //
  // The test enforces that ordering rather than trusting this comment.
  if (u.hostname.endsWith('.supabase.co')) return 'network-only';

  if (u.hostname === 'esm.sh') return 'revalidate';

  // Anything else off-site is somebody else's business.
  if (u.origin !== origin) return 'network-only';

  // Rule 2. The document itself, however it is spelled.
  if (mode === 'navigate') return 'network-first';
  if (u.pathname.endsWith('/') || u.pathname.endsWith('.html')) return 'network-first';

  // Rule 1 in practice: a ?v= URL names one specific build, so its contents can
  // never change under it. Safe to serve from the cache without asking.
  if (u.searchParams.has('v')) return 'cache-first';

  // Icons, the manifest, anything unversioned.
  return 'revalidate';
}

// ---------------------------------------------------------------------------

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    // Individually rather than addAll(), which rejects the whole install if any
    // single file 404s. A missing icon should not leave a device with no
    // service worker at all.
    await Promise.all(SHELL.map((path) =>
      cache.add(new Request(path, { cache: 'reload' })).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // Rule 1. Everything that is not this build or the vendor cache goes —
    // including the caches left behind by the first service worker, which is
    // the self-heal that used to live in main.js.
    const names = await caches.keys();
    await Promise.all(names
      .filter((n) => n !== CACHE_NAME && n !== VENDOR_CACHE)
      .map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  // The "Force refresh app" button in Settings still exists and still works by
  // unregistering outright. This is the gentler path for a future update prompt.
  if (event.data === 'skip-waiting') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const strategy = chooseStrategy({
    url: event.request.url,
    method: event.request.method,
    mode: event.request.mode,
    origin: self.location.origin,
  });

  if (strategy === 'network-only') return;   // not our business; browser handles it

  const cacheName = new URL(event.request.url).hostname === 'esm.sh' ? VENDOR_CACHE : CACHE_NAME;
  event.respondWith(handle(event.request, strategy, cacheName));
});

async function handle(request, strategy, cacheName) {
  const cache = await caches.open(cacheName);

  if (strategy === 'network-first') {
    try {
      const fresh = await fetch(request);
      if (fresh && fresh.ok) cache.put(request, fresh.clone()).catch(() => {});
      return fresh;
    } catch {
      // No signal. This is the whole point of the exercise.
      const cached = await cache.match(request) || await cache.match('./index.html');
      if (cached) return cached;
      throw new Error('offline and nothing cached');
    }
  }

  const cached = await cache.match(request);

  if (strategy === 'cache-first' && cached) return cached;

  const network = fetch(request).then((res) => {
    if (res && res.ok && res.type !== 'opaque') cache.put(request, res.clone()).catch(() => {});
    return res;
  });

  // revalidate: answer now from the cache if we have it, and let the refresh
  // finish in the background for next time. Nothing awaits it deliberately.
  if (cached) {
    network.catch(() => {});
    return cached;
  }
  return network;
}
