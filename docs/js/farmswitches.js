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
  if (!SWITCHES.some((s) => s.key === key)) return readSwitches(current);
  return { ...readSwitches(current), [key]: !!on };
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
