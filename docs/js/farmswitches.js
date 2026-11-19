// The switches an owner can turn on to change what a role can see or do on their farm.
//
// Every switch is off until the owner turns it on, and a farm with every switch off follows the standard rules. They are kept
// with the farm (the `switches` column of the farm row) and the database enforces the ones that matter, so a switch is not
// only a button the app hides: see supabase/migrations/20261209000000_farm_switches.sql. nav.js reads them for the tabs.
// Pure: no state, no screen.

/**
 * In the order they are shown. `area` is the part of the app it sits under on the grid, `needs` another switch it only means anything
 * with. `role` is the heading, `key` is what is saved, `label` is the line on the screen and `hint` is the
 * short plain sentence under it.
 */
export const SWITCHES = [
  { key: 'managerSeesPrices', area: 'Contracts and prices', role: 'Managers', label: 'See contract prices',
    hint: 'What each contract pays, so their Position and Sales show money. Off, they see tonnes only.' },
  { key: 'managerSeesOverheads', area: 'Overheads', role: 'Managers', label: "See overheads and the whole farm's profit",
    hint: 'The farm-wide costs set in Settings. Off, a manager sees margin per paddock but not the farm result.' },
  { key: 'workerSeesYields', area: 'Production', role: 'Workers', label: 'See yields and tonnes per paddock',
    hint: 'What each paddock produced. Off, a worker sees the paddock list without yields.' },
  { key: 'workerSeesPosition', area: 'Position', role: 'Workers', label: 'See the Position tab',
    hint: 'Tonnes produced, sold and unsold. Contract prices stay hidden.' },
  { key: 'driverOwnLoadsOnly', area: 'Loads and tickets', role: 'Drivers', label: 'See only the loads they entered',
    hint: 'Off, a driver sees every load on the farm, as the farm hands over loads between people.' },
  { key: 'workersRaiseSprays', area: 'Spray requests', role: 'Workers', label: 'Write spray requests',
    hint: 'They make a draft and save it. A manager sends it to the contractor.' },
  { key: 'bookkeeperEditsLoads', area: 'Loads and tickets', role: 'Bookkeepers', label: 'Add and change loads',
    hint: 'Off, a bookkeeper reads loads but cannot add or change one. They still cannot delete.' },
  { key: 'deleteOwnerManagerOnly', area: 'Loads and tickets', role: 'Deleting and weights', label: 'Only owners and managers delete',
    hint: 'A load or a contract. Off, anyone can delete what they entered.' },
  { key: 'finalWeightsManagersOnly', area: 'Loads and tickets', role: 'Deleting and weights', label: 'Only owners and managers mark a weight final',
    hint: 'Others enter loads as an estimate. Once a weight is final, only an owner or manager changes the load.' },
  { key: 'driverSeesStorage', area: 'Storage', role: 'Drivers', label: 'See the Storage tab',
    hint: 'The silos and what is in them. Silo contents are worked out from the loads, so with "only the loads they entered" on they will be short.' },
  { key: 'workerSeesSales', area: 'Contracts and prices', role: 'Workers', label: 'See contracts',
    hint: 'The Sales tab with contracts and tonnes. Prices stay hidden.' },
  { key: 'managerHidesBills', area: 'Invoices', role: 'Managers', label: 'Hide invoices and bills',
    hint: 'Off, a manager sees and handles them as the standard rules say. On, they are not sent to a manager at all.' },
  { key: 'advisorSeesLoads', area: 'Loads and tickets', role: 'Advisors', label: 'See loads and contracts',
    hint: 'Tonnes, Position and Reports, with no prices. An advisor always sees paddocks, production, inputs and sprays.' },
  { key: 'advisorSeesPrices', area: 'Contracts and prices', needs: 'advisorSeesLoads', role: 'Advisors', label: 'See prices, invoices and bills',
    hint: 'Needs loads and contracts on as well.' },
  { key: 'advisorSeesOverheads', area: 'Overheads', needs: 'advisorSeesLoads', role: 'Advisors', label: 'See overheads',
    hint: 'The farm-wide costs set in Settings.' },
];

/** The switches that are on, as a plain object of key -> true/false (anything not exactly true counts as off). */
export function readSwitches(raw) {
  const out = {};
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) for (const s of SWITCHES) if (s.key in raw) out[s.key] = raw[s.key] === true;
  return out;
}

/** The saved switches with one changed. Off is kept as an explicit false, so turning a switch off again reaches the server. */
export function withSwitch(current, key, on) {
  if (!SWITCHES.some((s) => s.key === key)) return keepLevels(current, readLevels(current));
  return { ...keepLevels(current, readLevels(current)), [key]: !!on };
}

/** The questions under one area of the grid (an area of helpcontent.js's ACCESS), in order. */
export const switchesForArea = (area) => SWITCHES.filter((s) => s.area === area);

/** The headings in order, each with its switches: [{ role, items: [...] }]. */
export function switchGroups() {
  const groups = [];
  for (const s of SWITCHES) {
    let g = groups.find((x) => x.role === s.role);
    if (!g) { g = { role: s.role, items: [] }; groups.push(g); }
    g.items.push(s);
  }
  return groups;
}

// --- what each role may do in each area: the owner's choice, kept with the farm ---------------------------------------------------
//
// The standard rules (helpcontent.js ACCESS, with the switches above) say what a role can do in an area. An owner can take some of that
// away from a role on their own farm: Full becomes See, or None. These choices only ever narrow: a role is never given more than
// the standard rules and the switches give it (that is what the switches are for). They are kept in the same place as the switches,
// farms.switches -> levels: { loads: { bookkeeper: 'view' }, ... }. The database enforces the areas that have tables of their own
// (see supabase/migrations/20261220000000_access_levels.sql); the areas that are only screens (Position, Storage, Reports) hide the tab.

/** The roles an owner can set. The owner is always Full, and People and Settings are the owner's own. */
export const LEVEL_ROLES = ['manager', 'bookkeeper', 'farm_worker', 'driver', 'advisor'];

/** The areas with tables of their own, and the tables each one holds back: the same list the database policies are written from. */
export const LEVEL_TABLES = {
  production: ['fields', 'field_agronomy'],
  contracts: ['sales', 'sale_terms', 'sale_documents'],
  invoices: ['invoices'],
  bills: ['payables'],
  overheads: ['overheads'],
  grainorders: ['orders'],
  freightorders: ['freight_orders'],
  loads: ['movements', 'movement_legs', 'movement_photos'],
  sprays: ['spray_jobs'],
  inputs: ['input_stock'],
};

/** The areas that are a screen made from the others: None hides the tab, and the data under it is kept by the areas above. */
export const SCREEN_AREAS = ['position', 'storage', 'reports'];

/** Every area an owner can change. */
export const LEVEL_AREAS = [...Object.keys(LEVEL_TABLES), ...SCREEN_AREAS];

/** The tab each area opens, where it has one (an area with none is a part of another screen). */
export const AREA_TAB = { position: 'position', production: 'production', contracts: 'sales', loads: 'movement', storage: 'storage', reports: 'reports' };

const RANK = { none: 0, tonnes: 1, view: 2, used: 2, draft: 2, own: 3, full: 4 };
export const levelRank = (level) => RANK[level] ?? 0;

/** The saved choices, cleaned: { area: { role: 'none' | 'tonnes' | 'view' | 'full' } }, with nothing in it that is not a real area, role or level. */
export function readLevels(raw) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) && raw.levels && typeof raw.levels === 'object' ? raw.levels : {};
  const out = {};
  for (const area of LEVEL_AREAS) {
    const row = src[area];
    if (!row || typeof row !== 'object') continue;
    for (const role of LEVEL_ROLES) {
      const v = row[role];
      if (v === 'none' || v === 'view' || v === 'full' || (v === 'tonnes' && area === 'contracts')) (out[area] ||= {})[role] = v;
    }
  }
  return out;
}

/** The saved switches with one choice changed (null puts it back to the standard). Keeps the switches. */
export function withLevel(current, area, role, level) {
  if (!LEVEL_AREAS.includes(area) || !LEVEL_ROLES.includes(role)) return keepLevels(current, readLevels(current));
  const levels = readLevels(current);
  if (level == null) { if (levels[area]) { delete levels[area][role]; if (!Object.keys(levels[area]).length) delete levels[area]; } }
  else (levels[area] ||= {})[role] = level;
  return keepLevels(current, readLevels({ levels }));
}

/** The switches as they are, with these choices alongside (nothing added when there are none). */
function keepLevels(current, levels) {
  return { ...readSwitches(current), ...(Object.keys(levels).length ? { levels } : {}) };
}

/** The level a role ends up with: the owner's choice if it takes something away, else the standard. */
export function narrowTo(standard, chosen) {
  return chosen && levelRank(chosen) < levelRank(standard) ? chosen : standard;
}

/**
 * What an owner may pick for a role in an area, lowest first. The standard (what the rules give it now) is the top: nothing above it.
 * `prices` is whether this role is shown contract prices now, which is what makes "See without prices" a real choice.
 */
export function levelChoices(standard, { area = '', prices = false } = {}) {
  const out = [];
  const add = (v) => { if (!out.includes(v)) out.push(v); };
  add('none');
  if (area === 'contracts' && prices && levelRank(standard) >= levelRank('view')) add('tonnes');
  if (levelRank(standard) > levelRank('view')) add('view');
  if (standard !== 'none') add(standard === 'tonnes' ? 'tonnes' : standard);
  return out;
}
