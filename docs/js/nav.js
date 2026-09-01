// Which parts of the app each role can reach.
//
// The database already decides who may read what — see the RLS policies in
// supabase/migrations. This decides what the interface offers, and the two have
// to agree. Where they do not, nothing errors: the server simply returns
// nothing, and the person gets a screen of empty rows and zeroes with no
// explanation. A driver opening Production today sees a paddock list with no
// yields, no urea and no seed, because field_agronomy quite correctly refuses
// them — which looks like a broken app rather than a boundary.
//
// So this file is deliberately thin and declarative, and tests/nav.test.mjs
// reads the migrations to check every entry against the policy that governs it.
// Adding a tab a role cannot read fails the suite.
//
// Pulled out of main.js for the same reason as boot.js and reconcile.js: a
// decision worth testing should not be trapped inside a render function.

export const ROLES = ['owner', 'manager', 'bookkeeper', 'farm_worker', 'driver'];

/**
 * The table each tab is useless without.
 *
 * Not every table a screen touches — the one that, if unreadable, leaves the
 * screen with nothing to say. Sales maps to `sales` rather than `sale_terms`
 * because a manager can legitimately see contract numbers and tonnages with the
 * pricing withheld; that is the split working as designed, not a broken tab.
 */
export const TAB_NEEDS = {
  position:   'movements',
  production: 'field_agronomy',
  sales:      'sales',
  movement:   'movements',
  storage:    'storages',
  reports:    'movements',
  settings:   'commodities',
};

/**
 * The tab bar, per role, in the order it is shown.
 *
 * The first entry is also where that role lands on opening the app, which is
 * why driver reads `['movement']` rather than a filtered copy of everyone
 * else's list — a driver opening onto an empty Position screen would be a poor
 * first impression of an app they did not ask to use.
 */
export const TABS_BY_ROLE = {
  owner:       ['position', 'production', 'sales', 'movement', 'storage', 'reports'],
  manager:     ['position', 'production', 'sales', 'movement', 'storage', 'reports'],
  bookkeeper:  ['position', 'production', 'sales', 'movement', 'storage', 'reports'],
  // No Position for a worker: it is the book — tonnes on hand, unsold value,
  // what the season is worth. A worker needs to know where grain went, not
  // what it is worth.
  farm_worker: ['production', 'movement', 'storage', 'reports'],
  driver:      ['movement'],
};

/**
 * Reachable without appearing in the bar.
 *
 * Account is on every role because that is where signing out lives, and an app
 * you cannot sign out of is a problem on a shared ute laptop. Settings holds
 * commodity setup and the business and bank details, so it stops at manager.
 */
export const OFF_BAR_BY_ROLE = {
  owner:       ['settings', 'account'],
  manager:     ['settings', 'account'],
  bookkeeper:  ['settings', 'account'],
  farm_worker: ['account'],
  driver:      ['account'],
};

const known = (role) => (ROLES.includes(role) ? role : 'driver');

/** Tab ids for the bar, in order. Unknown roles get the narrowest bar there is. */
export function tabsForRole(role) {
  return [...TABS_BY_ROLE[known(role)]];
}

/** Everything the role may open, bar or not. */
export function routesForRole(role) {
  const r = known(role);
  return [...TABS_BY_ROLE[r], ...OFF_BAR_BY_ROLE[r]];
}

/** Where this role lands with no route in the address bar. */
export function landingTabFor(role) {
  return TABS_BY_ROLE[known(role)][0];
}

/**
 * Where the gear at the top right goes for this role.
 *
 * Account is reached from the Settings screen, so hiding the gear from a driver
 * hid the only route to it — and with it the only way to sign out. A driver
 * with no way out of the app is worse than a driver who can see a settings
 * page, particularly on a laptop that lives in a ute and gets handed around.
 *
 * So the gear stays for everyone and changes destination: Settings for those
 * who have it, Account for those who do not.
 */
export function gearTargetFor(role) {
  return canOpen(role, 'settings') ? 'settings' : 'account';
}

/**
 * May this role open this route?
 *
 * Used to guard the address bar as well as the tab bar. Hiding a tab is a
 * courtesy, not a control — anyone can type #/sales — and while the server
 * would refuse the data anyway, sending someone to a screen that cannot work is
 * worse than not offering it. The real enforcement is in the RLS policies and
 * stays there.
 */
export function canOpen(role, routeId) {
  return routesForRole(role).includes(routeId);
}
