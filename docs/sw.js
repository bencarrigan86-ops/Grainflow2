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

// The page and its manifest. Everything else the build needs comes from precache.json (written by tools/make-precache.mjs, and
// checked against docs/ by tests/precache.test.mjs), downloaded in full before this version takes over.
//
// Runtime caching alone was not enough, and it failed in the one place it matters. A new build's scripts were fetched through the
// OLD worker into the OLD build's cache, which the new worker then deleted as stale. A phone that updated and was opened next with
// no signal found the new index.html and none of its scripts: a blank page until one more launch with signal. The same happened on
// a first install, because the worker does not control the page that registers it.
const SHELL = ['./', './index.html', './manifest.webmanifest'];

// How long a page request waits for the network before the saved page is used instead (a paddock with one bar of signal
// answers slowly rather than not at all, and a white screen is worse than the saved page).
const NAVIGATE_WAIT_MS = 4000;

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

/**
 * A response that was reached through a redirect says so (response.redirected), and a browser will not show a page the worker
 * hands it with that flag set: Safari answers "Response served by service worker has redirections" and the app does not open.
 * The host redirects /index.html to / (the home-screen icon starts at /index.html), so a saved copy of that page carries the flag.
 * Rebuilding the response from its body drops it, and the page is then served as a plain 200.
 */
function plain(res) {
  if (!res || !res.redirected) return res;
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: res.headers });
}

/** Fetch one file fresh from the network and keep it, as a plain response. Rejects if it cannot be had. */
async function saveClean(cache, path) {
  const res = await fetch(path, { cache: 'reload' });
  if (!res || !res.ok) throw new Error(`could not download ${path}`);
  await cache.put(path, plain(res));
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    // Everything this build needs. If any of it cannot be had, the install FAILS and the previous version carries on (and the
    // browser tries again at the next check): taking over with half a build is how a phone ends up blank offline.
    const res = await fetch(`./precache.json?v=${encodeURIComponent(VERSION)}`, { cache: 'reload' });
    if (!res.ok) throw new Error('precache.json not found');
    const list = await res.json();
    const required = [...new Set([...SHELL, ...(list.required || [])])];
    await Promise.all(required.map((path) => saveClean(cache, path)));
    // Icons, help pictures and the form: wanted offline, but one missing must not stop an update.
    await Promise.all((list.optional || []).map((path) => saveClean(cache, path).catch(() => {})));
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
      // The home-screen icon opens /index.html, which the host redirects to /. Ask for / itself, so nothing is redirected.
      const isIndexPage = request.mode === 'navigate' && new URL(request.url).pathname.endsWith('/index.html');
      const attempt = (isIndexPage ? fetch('./') : fetch(request)).then((fresh) => {
        if (fresh && fresh.ok) cache.put(request, plain(fresh.clone())).catch(() => {});
        return plain(fresh);
      });
      // A page open waits only so long for the network when there is a saved page to fall back on; the request carries on in the
      // background and refreshes the saved page for next time.
      if (request.mode === 'navigate') {
        const saved = plain(await cache.match(request) || await cache.match('./') || await cache.match('./index.html'));
        if (saved) {
          attempt.catch(() => {});
          return await Promise.race([attempt, new Promise((resolve) => setTimeout(() => resolve(saved), NAVIGATE_WAIT_MS))]);
        }
      }
      return await attempt;
    } catch {
      // No signal. This is the whole point of the exercise.
      const cached = plain(await cache.match(request) || await cache.match('./') || await cache.match('./index.html'));
      if (cached) return cached;
      throw new Error('offline and nothing cached');
    }
  }

  const cached = await cache.match(request);

  if (strategy === 'cache-first' && cached) return plain(cached);

  const network = fetch(request).then((res) => {
    if (res && res.ok && res.type !== 'opaque') cache.put(request, plain(res.clone())).catch(() => {});
    return plain(res);
  });

  // revalidate: answer now from the cache if we have it, and let the refresh
  // finish in the background for next time. Nothing awaits it deliberately.
  if (cached) {
    network.catch(() => {});
    return plain(cached);
  }
  return network;
}
