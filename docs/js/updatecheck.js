// Telling somebody a newer build is out while the app is open.
//
// A phone that is only put down and picked up again never reloads, so it keeps running the build it opened with. The service worker
// installs the new build quietly, but the page in front of the user does not change until it is reloaded. This looks at the home page
// (the one file that is never answered from the cache while there is signal), reads the build number it points at, and offers a
// reload when it is newer. Nothing reloads by itself: somebody may be half way through a load.

/** The build number the home page points at (the ?v= on main.js), or null when the text is not the home page. */
export function newestBuild(html) {
  const m = /js\/main\.js\?v=(\d+)/.exec(String(html ?? ''));
  return m ? Number(m[1]) : null;
}

/** This build's number: the last part of the version, 2026-11-16.309 gives 309. */
export function currentBuild(appVersion) {
  const n = Number(String(appVersion ?? '').split('.').pop());
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Newer only. A page that is somehow older than this one (a rollback) is not a reason to interrupt anybody. */
export function isNewer(current, newest) {
  return current != null && newest != null && newest > current;
}

/**
 * Looks for a newer build now. Resolves with its number, or null when this is the newest or the server could not be asked (no signal
 * is not an error: the answer is simply not known yet).
 */
export async function checkForNewBuild(appVersion, fetchFn = (...a) => fetch(...a)) {
  try {
    const res = await fetchFn('./', { cache: 'no-store' });
    if (!res || !res.ok) return null;
    const newest = newestBuild(await res.text());
    return isNewer(currentBuild(appVersion), newest) ? newest : null;
  } catch { return null; }
}

const BAR_ID = 'update-bar';

/** The bar above the tabs. "Update now" reloads; "Later" hides it until the app is next picked up. */
export function showUpdateBar(doc = document, reload = () => location.reload()) {
  if (doc.getElementById(BAR_ID)) return doc.getElementById(BAR_ID);
  const bar = doc.createElement('div');
  bar.id = BAR_ID;
  bar.className = 'update-bar';
  bar.setAttribute('role', 'status');
  bar.innerHTML = `<div class="update-text"><b>A new version is ready.</b><span>Save what you are doing first.</span></div>
    <div class="update-actions"><button type="button" class="btn small" id="update-now">Update now</button><button type="button" class="btn secondary small" id="update-later">Later</button></div>`;
  doc.body.appendChild(bar);
  bar.querySelector('#update-now').addEventListener('click', () => { bar.querySelector('#update-now').disabled = true; reload(); });
  bar.querySelector('#update-later').addEventListener('click', () => hideUpdateBar(doc));
  return bar;
}

export function hideUpdateBar(doc = document) { doc.getElementById(BAR_ID)?.remove(); }

/**
 * Asks now, for the Settings button: 'newer' (and the bar is shown), 'current', or 'unknown' when the server could not be reached.
 */
export async function checkNow(appVersion, { show = showUpdateBar, fetchFn } = {}) {
  let reached = false;
  const probe = (...a) => (fetchFn || ((...b) => fetch(...b)))(...a).then((r) => { if (r && r.ok) reached = true; return r; });
  const found = await checkForNewBuild(appVersion, probe);
  if (found) { show(); return { state: 'newer', build: found }; }
  return { state: reached ? 'current' : 'unknown', build: null };
}

/**
 * Starts looking. A new build takes a minute or two to appear after it is pushed, so a check that says "nothing yet" is not the end of it:
 * it looks shortly after the app opens, again two and five minutes in, then every five minutes while the app is in front, and whenever the
 * app is picked up, comes back into view or regains signal (at most once a minute). A look that falls while the screen is off is made up
 * for the moment it is back. Once a newer build is found the bar stays up; "Later" hides it until the next pick-up.
 */
export function startUpdateCheck(appVersion, { minGapMs = 60 * 1000, everyMs = 5 * 60 * 1000, followUpsMs = [15 * 1000, 2 * 60 * 1000, 5 * 60 * 1000] } = {}) {
  let last = 0;
  let found = null;
  let missed = false;
  const look = async (force = false) => {
    if (document.hidden) { missed = true; return; }
    if (found) { showUpdateBar(); return; }
    if (!force && Date.now() - last < minGapMs) return;
    last = Date.now();
    missed = false;
    found = await checkForNewBuild(appVersion);
    if (found) showUpdateBar();
  };
  const back = () => { if (!document.hidden) look(missed); };
  document.addEventListener('visibilitychange', back);
  window.addEventListener('focus', back);
  window.addEventListener('pageshow', back);
  window.addEventListener('online', () => look(true));
  followUpsMs.forEach((ms) => setTimeout(() => look(true), ms));
  setInterval(() => look(), everyMs);
}
