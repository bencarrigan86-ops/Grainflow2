// Coming back by a password reset link.
//
// "Forgot password" emails a link. Following it brings the person back to the app with a session that is good for one thing: choosing
// a new password. The sign-in library reads the link out of the address bar and then removes it, so what it said has to be noted
// first (see supabase.js), and kept for the tab, because the page may reload before the new password has been chosen.
//
// Pure apart from the storage handed in (the tab's own, by default), so it is testable without a page.

const RECOVERING = 'grainflow.recovering';
const EXPIRED = 'grainflow.resetExpired';

const store = () => { try { return globalThis.sessionStorage || null; } catch { return null; } };

/** Is this address-bar fragment a password reset link? ("#access_token=…&type=recovery") */
export const isRecoveryHash = (hash) => /[#&]type=recovery(&|$)/.test(String(hash || ''));

/** Is it a reset link the server refused: used already, or too old? ("#error=access_denied&error_code=otp_expired…") */
export const isExpiredLinkHash = (hash) => /[#&]error=/.test(String(hash || '')) && /(otp_expired|expired|invalid)/i.test(String(hash || ''));

/** Note what the address bar says about a reset link, before the sign-in library clears it. */
export function noteRecoveryLink(hash, storage = store()) {
  if (!storage) return;
  try {
    if (isRecoveryHash(hash)) storage.setItem(RECOVERING, '1');
    else if (isExpiredLinkHash(hash)) storage.setItem(EXPIRED, '1');
  } catch { /* private mode: the link still works for this page load */ }
}

/** Has this tab arrived by a reset link and not yet chosen the new password? */
export function isRecovering(storage = store()) {
  try { return storage?.getItem(RECOVERING) === '1'; } catch { return false; }
}

/** The new password has been chosen (or the person has gone on without): back to normal. */
export function endRecovery(storage = store()) {
  try { storage?.removeItem(RECOVERING); } catch { /* nothing to do */ }
}

/** Was the reset link dead? Said once: asking clears it. */
export function takeResetExpired(storage = store()) {
  try {
    const yes = storage?.getItem(EXPIRED) === '1';
    if (yes) storage.removeItem(EXPIRED);
    return yes;
  } catch { return false; }
}

/** A password to choose: long enough, typed twice the same. '' when it will do, else what to tell the person. */
export function checkNewPassword(password, again) {
  if (!password) return 'Type the new password.';
  if (String(password).length < 6) return 'Password needs to be at least 6 characters.';
  if (password !== again) return 'The two passwords are not the same.';
  return '';
}

/** Where the emailed link brings them back to: this app's front door, with nothing after it. */
export const resetRedirect = (loc = globalThis.location) => (loc ? `${loc.origin}${loc.pathname}` : '');

export const RESET_SENT = 'If that email has an account, a link to choose a new password is on its way. It can take a minute. Check your junk folder too.';
export const RESET_EXPIRED = 'That reset link has expired or was already used. Ask for a new one.';

/** Does this error from the sign-in service say the account no longer exists (deleted on the server)? */
export function accountGone(error) {
  const m = String(error?.message || '').toLowerCase();
  const status = Number(error?.status) || 0;
  return m.includes('does not exist') || m.includes('user_not_found') || m.includes('user not found') || m.includes('sub claim')
    || ((status === 403 || status === 401) && !m.includes('fetch'));
}
