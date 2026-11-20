// Opening the app with no signal on a login that has run out.
//
// The login's access token lasts about an hour, and one that has run out cannot be renewed without signal, so Supabase reports "no
// session" and the app showed the sign-in screen (which needs signal): a phone left overnight could not be opened in a paddock. If
// the device is still signed in, holds this person's farm copy, and remembers their place on the farm, it opens from the device and
// signs in again by itself when signal comes back.
//
// Not a security decision. What the farm will send or accept is still decided by the server, which does not answer a login that has
// run out; this only chooses whether to show the person the copy that is already on their own phone.
//
// Pure (storage and the two device stamps are handed in) so the rule can be tested without a browser.

/**
 * Whether the stored login is still there: Supabase keeps it in localStorage under sb-<project>-auth-token and removes it at
 * sign-out. An expired access token still counts (it renews when there is signal); a signed-out device has none.
 */
export function hasStoredLogin(storage) {
  try {
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i);
      if (!/^sb-.+-auth-token$/.test(key || '')) continue;
      const v = JSON.parse(storage.getItem(key) || 'null');
      if (v && (v.refresh_token || v.access_token)) return true;
    }
  } catch { /* unreadable: treat as signed out */ }
  return false;
}

/**
 * @param {object} o
 * @param {boolean|undefined} o.online      navigator.onLine (only an explicit false means offline)
 * @param {object} o.storage                localStorage
 * @param {string|null} o.farmStamp         which farm the saved copy on this device belongs to
 * @param {string|null} o.copyOwner         which person that copy was last used by (null for one saved before this was kept)
 * @returns {{user:{id:string}, offline:true}|null}
 */
export function decideOfflineSession({ online, storage, farmStamp = null, copyOwner = null }) {
  if (online !== false) return null;
  if (!hasStoredLogin(storage)) return null;
  let saved = null;
  try { saved = JSON.parse(storage.getItem('grainflow.membership') || 'null'); } catch { return null; }
  if (!saved?.userId || !saved.membership?.farmId) return null;
  if (farmStamp !== saved.membership.farmId) return null;    // nothing of this farm on the device to open
  if (copyOwner && copyOwner !== saved.userId) return null;  // the copy was left by someone else
  return { user: { id: saved.userId }, offline: true };
}
