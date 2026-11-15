// Living on a phone: whether the app is installed to the home screen, how to install it, and whether the phone has
// promised to keep the app's stored data.
//
// Everything entered is kept on the device first (IndexedDB) and sent when there is signal. A browser may clear a
// site's stored data when the phone runs short of space, unless the site has asked for it to be kept (persistent
// storage). An app added to the home screen is far less likely to be cleared, and the browser is more willing to grant
// the request. The decisions are pure and take the browser's objects as arguments so they can be tested; installWatch()
// and the helpers at the foot are the only parts that touch the page.

/** 'ios', 'android' or 'other', from the user agent (an iPad that says it is a Mac is told by its touch points). */
export function platformOf(ua = '', touchPoints = 0) {
  const s = String(ua);
  if (/iPhone|iPad|iPod/i.test(s)) return 'ios';
  if (/Macintosh/i.test(s) && touchPoints > 1) return 'ios';
  if (/Android/i.test(s)) return 'android';
  return 'other';
}

/** Whether this is the installed app rather than a page in a browser tab. */
export function isStandalone(win = globalThis.window) {
  try {
    return !!(win?.navigator?.standalone || win?.matchMedia?.('(display-mode: standalone)')?.matches || win?.matchMedia?.('(display-mode: fullscreen)')?.matches);
  } catch { return false; }
}

/** The steps to add Grainflow to the home screen on this kind of phone. */
export function installSteps(platform) {
  if (platform === 'ios') {
    return [
      'Open Grainflow in Safari. (On an iPhone it is the one place the option is always there.)',
      'Tap the Share button, the square with an arrow, at the bottom of the screen.',
      'Scroll down and tap Add to Home Screen, then Add.',
      'From now on, open Grainflow from its icon on the home screen.',
    ];
  }
  if (platform === 'android') {
    return [
      'Open Grainflow in Chrome.',
      'Tap the menu, the three dots at the top right.',
      'Tap Install app (or Add to Home screen), then Install.',
      'From now on, open Grainflow from its icon on the home screen.',
    ];
  }
  return [
    'On a phone, open this page in Safari (iPhone) or Chrome (Android).',
    'Use Add to Home Screen from the Share button or the menu.',
    'On a computer, Chrome and Edge show an install icon at the right of the address bar.',
  ];
}

/**
 * What the device card says about installing.
 * @param {{standalone: boolean, platform: string, canPrompt: boolean}} s
 * @returns {{state: 'installed'|'prompt'|'steps', text: string}}
 */
export function installState({ standalone = false, platform = 'other', canPrompt = false } = {}) {
  if (standalone) return { state: 'installed', text: 'Installed on this device.' };
  if (canPrompt) return { state: 'prompt', text: 'Not on your home screen yet. One tap installs it.' };
  if (platform === 'other') return { state: 'steps', text: 'Not installed. On a phone it is added to the home screen; on a computer the browser offers to install it.' };
  return { state: 'steps', text: 'Not on your home screen yet. It opens faster from there, works the same with no signal, and the phone is less likely to clear what is saved on it.' };
}

/**
 * Asks the browser to keep this site's stored data. Resolves to 'kept' (already promised, or granted now), 'refused' or
 * 'unsupported'. Never throws.
 */
export async function requestPersistence(storage = globalThis.navigator?.storage) {
  try {
    if (!storage?.persist) return 'unsupported';
    if (storage.persisted && await storage.persisted()) return 'kept';
    return (await storage.persist()) ? 'kept' : 'refused';
  } catch { return 'unsupported'; }
}

/** What the browser says about the space: {persisted, usageMb, quotaMb}, with nulls where it will not say. */
export async function storageStatus(storage = globalThis.navigator?.storage) {
  const out = { persisted: null, usageMb: null, quotaMb: null };
  try { if (storage?.persisted) out.persisted = !!(await storage.persisted()); } catch { /* unknown */ }
  try {
    const est = storage?.estimate ? await storage.estimate() : null;
    if (est) {
      out.usageMb = Math.round(((est.usage || 0) / 1048576) * 10) / 10;
      out.quotaMb = Math.round((est.quota || 0) / 1048576);
    }
  } catch { /* unknown */ }
  return out;
}

/** The words for the storage line. */
export function storageText(st, standalone = false) {
  if (!st || st.persisted === null) return 'This browser does not say whether it will keep what is saved on this device.';
  if (st.persisted) return 'Protected: this phone has promised to keep what is saved on it, even when it runs short of space.';
  return standalone
    ? 'Not protected yet. Tap the button to ask the phone to keep what is saved on it.'
    : 'Not protected. The phone may clear what is saved here if it runs short of space. Adding Grainflow to the home screen helps.';
}

// ---------------------------------------------------------------------------------------------------------------
// the page

let deferred = null;

/** Starts listening for the browser's offer to install (Chrome and Android). Call once, early. */
export function installWatch(win = globalThis.window) {
  if (!win || win.__grainflowInstallWatch) return;
  win.__grainflowInstallWatch = true;
  win.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; });
  win.addEventListener('appinstalled', () => { deferred = null; });
}

export const canPromptInstall = () => !!deferred;

/** Shows the browser's own install prompt. Resolves to 'accepted', 'dismissed' or 'unavailable'. */
export async function promptInstall() {
  if (!deferred) return 'unavailable';
  try {
    deferred.prompt();
    const choice = await deferred.userChoice;
    deferred = null;
    return choice?.outcome === 'accepted' ? 'accepted' : 'dismissed';
  } catch { deferred = null; return 'unavailable'; }
}
