// Which database this copy of the app talks to.
//
// The live app (and localhost, as it has always been) uses the live database. A test copy is the same files deployed
// under a name that starts with "grainflow2-test", pointed at a second Supabase project, so changes can be tried
// without touching the farm's real records. Until the test project's address and key are filled in below, a test copy
// talks to nothing at all: it never falls back to the live database. See STAGING.md for the setup.
// Both keys are the publishable kind, which are meant to be in the browser (see supabase.js).

export const LIVE = {
  name: 'live',
  url: 'https://mvrlvytoplpwglgkxqpp.supabase.co',
  key: 'sb_publishable_v8t04o3uoNx-Dt9VMVvyow_2Q17cG6V',
};

// The address people are sent to: the front door of the live app, as it appears in the trial invitation message and its link.
// When the live app moves to its own domain, this is the one line to change (and nothing else shows the old address).
export const APP_ADDRESS = 'https://grainflow2.bencarrigan86.workers.dev/';

// The test project (STAGING.md). The key is the publishable kind, which is meant to be in the browser.
export const TEST = { name: 'test', url: 'https://lnezobhpgnaismtowrhl.supabase.co', key: 'sb_publishable_ftAFjvTvIkEnh49OvyaRMg_Cr4r3Qra' };

const UNREACHABLE = 'https://test-copy-not-set-up.invalid';

/** The test copy is any host whose name starts with "grainflow2-test". */
export const isTestHost = (hostname) => /^grainflow2-test[.-]/.test(String(hostname || '').toLowerCase());

/** @returns {{name: string, url: string, key: string, configured: boolean}} */
export function environmentFor(hostname, test = TEST, live = LIVE) {
  if (!isTestHost(hostname)) return { ...live, configured: true };
  const configured = !!(test.url && test.key);
  return { name: 'test', url: configured ? test.url : UNREACHABLE, key: configured ? test.key : 'not-set-up', configured };
}
