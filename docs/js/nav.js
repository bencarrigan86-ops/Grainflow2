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

import { AREA_TAB, levelRank } from './farmswitches.js?v=432';

export const ROLES = ['owner', 'manager', 'bookkeeper', 'farm_worker', 'driver', 'advisor'];

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
  // No Position and no Storage for a bookkeeper: the money side is contracts, invoices and bills, and they look at paddocks and loads
  // but change neither. Sales is first, so it is where they land.
  bookkeeper:  ['sales', 'production', 'movement', 'reports'],
  // No Position for a worker: it is the book — tonnes on hand, unsold value,
  // what the season is worth. A worker needs to know where grain went, not
  // what it is worth.
  farm_worker: ['production', 'movement', 'storage', 'reports'],
  driver:      ['movement'],
  // support: the person the owner has let look at the farm, read only. Sees what an owner sees, writes nothing.
  support:     ['position', 'production', 'sales', 'movement', 'storage', 'reports'],
  // advisor: an agronomist, accountant or bank the owner has let look, read only. Paddocks and storage always; the rest (loads and
  // contracts, then prices and overheads) only as the owner switches them on: see tabsForRole().
  advisor:     ['production', 'storage'],
};

/**
 * Reachable without appearing in the bar.
 *
 * Account is on every role because that is where signing out lives, and an app
 * you cannot sign out of is a problem on a shared ute laptop. Settings holds
 * commodity setup and the business and bank details, so it stops at manager.
 */
export const OFF_BAR_BY_ROLE = {
  owner:       ['settings', 'account', 'help'],
  manager:     ['settings', 'account', 'help'],
  bookkeeper:  ['settings', 'account', 'help'],
  farm_worker: ['account', 'help'],
  driver:      ['account', 'help'],
  support:     ['settings', 'account', 'help'],
  advisor:     ['account', 'help'],
};

// The farm's own switches (see farmswitches.js), handed over by storage.js whenever the farm is loaded or they change.
let switches = {};
export function setFarmSwitches(obj) { switches = obj && typeof obj === 'object' && !Array.isArray(obj) ? { ...obj } : {}; }
export const farmSwitch = (key) => switches[key] === true;

// What the owner has taken away from a role in an area (farmswitches.js, readLevels), handed over the same way. Empty: the standard rules.
let levels = {};
export function setFarmLevels(obj) { levels = obj && typeof obj === 'object' && !Array.isArray(obj) ? obj : {}; }
/** The owner's pick for this role in this area ('none', 'tonnes', 'view', 'full'), or '' when it is the standard. */
export const farmLevel = (role, area) => levels?.[area]?.[role] || '';
const cut = (role, area) => farmLevel(role, area) === 'none';
/**
 * May this role see this area? The owner's pick is the whole answer when there is one (so it can give more than the standard rule
 * as well as less); with none, `standard` is what the standard rule and the switches say (true where this is only used to take away).
 */
export const canSeeArea = (role, area, standard = true) => { const o = farmLevel(role, area); return o ? levelRank(o) >= 1 : standard; };
/** May this role add and change in this area? Same shape: only Full does, when the owner has picked; else the standard. */
export const canChangeArea = (role, area, standard = true) => { const o = farmLevel(role, area); return o ? o === 'full' : standard; };

const known = (role) => (ROLES.includes(role) || role === 'support' ? role : 'driver');

/** Tab ids for the bar, in order. Unknown roles get the narrowest bar there is. */
const TAB_ORDER = ['position', 'production', 'sales', 'movement', 'storage', 'reports'];

/** The bar the standard rules and the farm's switches give a role, less any tab the owner has set to None (before the owner gives any more). */
function standardBar(r) {
  let bar = [...TABS_BY_ROLE[r]];
  // a farm that has switched it on gives its workers Position as well, first in the bar like everyone else's
  if (r === 'farm_worker' && farmSwitch('workerSeesPosition') && !bar.includes('position')) bar.unshift('position');
  // two more the owner can give: a driver the Storage tab, a worker the Sales tab (contracts and tonnes, no prices)
  if (r === 'driver' && farmSwitch('driverSeesStorage')) bar.push('storage');
  if (r === 'farm_worker' && farmSwitch('workerSeesSales') && !bar.includes('sales')) bar.splice(bar.indexOf('production') + 1, 0, 'sales');
  // an advisor the owner has let see loads and contracts gets the rest of the bar, tonnes without prices unless those are on too
  if (r === 'advisor' && farmSwitch('advisorSeesLoads')) bar = ['position', 'production', 'sales', 'movement', 'storage', 'reports'];
  // and what the owner has set to None for this role on this farm
  return bar.filter((tab) => !Object.entries(AREA_TAB).some(([area, t]) => t === tab && cut(r, area)));
}

export function tabsForRole(role) {
  const r = known(role);
  const bar = standardBar(r);
  // a tab the owner has given this role (View or Full) goes where it belongs in the usual order: before the first tab that comes after it
  for (const tab of TAB_ORDER) {
    if (bar.includes(tab) || !Object.entries(AREA_TAB).some(([area, t]) => t === tab && levelRank(farmLevel(r, area)) >= 1)) continue;
    const next = bar.findIndex((x) => TAB_ORDER.indexOf(x) > TAB_ORDER.indexOf(tab));
    if (next < 0) bar.push(tab); else bar.splice(next, 0, tab);
  }
  return bar.sort((a, b) => TAB_ORDER.indexOf(a) - TAB_ORDER.indexOf(b));   // the same order for everyone; where a role opens is landingTabFor()
}

/** Everything the role may open, bar or not. */
export function routesForRole(role) {
  const r = known(role);
  return [...tabsForRole(r), ...OFF_BAR_BY_ROLE[r]];
}

/** Where this role lands with no route in the address bar. */
export function landingTabFor(role) {
  return standardBar(known(role))[0] || tabsForRole(role)[0] || 'account';   // an owner can take every tab away: Account is always there
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

/**
 * May this role see yields — what a paddock produced, per hectare and in total?
 *
 * Yield is the number a worker has no need of: they apply fertiliser and sow
 * seed, and neither depends on knowing what the crop made. It follows the same
 * line as Position, which is where yields turn into money, so there is one rule
 * to remember rather than two that drift apart.
 *
 * Be clear about what this is. It decides what the interface offers. The
 * database does not yet withhold yields from a worker — they sit in
 * field_agronomy beside urea and seed, which a worker legitimately reads — and
 * the loads a worker logs carry tonnes. Moving yield to a table of its own is
 * what would make this a control rather than a courtesy.
 */
export function canSeeYield(role) {
  // a farm can also let its workers see yields without giving them the Position tab
  return canOpen(role, 'position') || role === 'bookkeeper' || (role === 'farm_worker' && farmSwitch('workerSeesYields'));
}

/** Grain orders (who is to deliver what, and when): an owner and a manager. A bookkeeper is not sent them. */
export const canSeeOrders = (role) => canSeeArea(role, 'grainorders', role === 'owner' || role === 'manager');

/** Freight orders (loads to cart, and the carrier): an owner, a manager and a bookkeeper. */
export const canSeeFreight = (role) => canSeeArea(role, 'freightorders', ['owner', 'manager', 'bookkeeper'].includes(role));

/** May this role add and change contracts? An owner and a bookkeeper. */
export const canAddContracts = (role) => canChangeArea(role, 'contracts', role === 'owner' || role === 'bookkeeper');

/** The whole farm's overheads: an owner; a manager once the farm has switched it on. A bookkeeper does not see them. */
export function canSeeOverheads(role) {
  let std = false;
  if (role === 'owner' || role === 'support') std = true;
  else if (role === 'manager') std = farmSwitch('managerSeesOverheads');
  else if (role === 'advisor') std = farmSwitch('advisorSeesLoads') && farmSwitch('advisorSeesOverheads');
  return canSeeArea(role, 'overheads', std);
}

/**
 * May this role change paddocks, yields and the stock of seed, fertiliser, fuel and chemical? A bookkeeper looks and changes
 * none of it (the database refuses the writes), and so does an advisor or the support login, so the screen offers no way to try.
 */
export const canChangeProduction = (role) => canChangeArea(role, 'production', !['bookkeeper', 'advisor', 'support'].includes(role));

/** May this role record what is bought, used and counted of seed, fertiliser, fuel and chemical? Those who change production, unless the owner has picked otherwise. */
export const canChangeInputs = (role) => canChangeArea(role, 'inputs', canChangeProduction(role));

/**
 * May this role add and change loads? Owners, managers, workers and drivers always; a bookkeeper only on a farm that has switched
 * it on; an advisor or support never. (The database says the same: see 20261210000000_farm_switches_two.sql.)
 */
export function canEditLoads(role) {
  const std = role === 'bookkeeper' ? farmSwitch('bookkeeperEditsLoads') : ['owner', 'manager', 'farm_worker', 'driver'].includes(role);
  return canChangeArea(role, 'loads', std);
}

/** May this role delete a load or a contract? An owner or manager always; the rest unless the farm has reserved it for them. */
export function canDelete(role) {
  return role === 'owner' || role === 'manager' || !farmSwitch('deleteOwnerManagerOnly');
}

/** May this role mark a weight final (and change a load once it is)? Same shape: an owner or manager always. */
export function canMarkFinal(role) {
  return role === 'owner' || role === 'manager' || !farmSwitch('finalWeightsManagersOnly');
}

/**
 * Is this role shown contract prices? An owner and a bookkeeper always; a manager once the farm has switched it on; an advisor once
 * it has switched on loads and prices. A report built on prices (Gross margin) is for these roles only: for anyone else the figures
 * would be sums with the prices left out.
 */
export function canSeePrices(role) {
  const picked = farmLevel(role, 'contracts');
  if (picked) return picked === 'view' || picked === 'full';   // the owner has chosen: only See and Full show the prices
  if (role === 'owner' || role === 'bookkeeper') return true;
  if (role === 'manager') return farmSwitch('managerSeesPrices');
  if (role === 'advisor') return farmSwitch('advisorSeesLoads') && farmSwitch('advisorSeesPrices');
  return false;
}

/**
 * Is this role shown invoices and bills? An owner and a bookkeeper always; a manager unless the farm has hidden them; an advisor
 * once it has switched on loads and prices. Nobody else (as the standard rules already say).
 */
export function canSeeBills(role) {
  let std = false;
  if (role === 'owner' || role === 'bookkeeper') std = true;
  else if (role === 'manager') std = !farmSwitch('managerHidesBills');
  else if (role === 'advisor') std = farmSwitch('advisorSeesLoads') && farmSwitch('advisorSeesPrices');
  return canSeeArea(role, 'invoices', std) || canSeeArea(role, 'bills', std);
}
